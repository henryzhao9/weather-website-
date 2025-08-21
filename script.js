// 和风天气API（按经纬度请求）
const QWEATHER_BASE = 'https://devapi.qweather.com/v7';
const QWEATHER_KEY = '0f493d0ad80ae004670d82205c1ec6b5';

// 简单内存缓存（带TTL）按坐标键
const cache = {
  now: new Map(),         // 'lat,lng' -> { value, time }
  forecast: new Map(),    // 'lat,lng' -> { value, time }
  hourly: new Map(),      // 'lat,lng' -> { value, time }
  geocode: new Map()      // city -> { value, time }
};
function getFromCache(map, key, ttlMs) {
  const item = map.get(key);
  if (item && Date.now() - item.time < ttlMs) return item.value;
  return null;
}
function setCache(map, key, value) {
  map.set(key, { value, time: Date.now() });
}

// 去抖工具
function debounce(fn, delay = 600) {
  let timer = null;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

// 地图相关变量（Leaflet）
let map;
let marker;
let currentPosition = { lat: 39.9042, lng: 116.4074 }; // 默认北京
let currentCityName = '北京';

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
  initMap();
  getCurrentLocation();
});

// 初始化Leaflet地图
function initMap() {
  map = L.map('map').setView([currentPosition.lat, currentPosition.lng], 10);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(map);
  map.on('click', function(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    updateMarker(lat, lng);
    reverseGeocode(lat, lng);
    updateWeatherByCurrentPosition();
  });
}

function updateMarker(lat, lng) {
  if (marker) marker.remove();
  marker = L.marker([lat, lng]).addTo(map);
  currentPosition = { lat, lng };
}

// 逆地理编码（坐标 -> 城市名）
async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'zh-CN' } });
    const data = await res.json();
    const addr = data.address || {};
    const city = addr.city || addr.town || addr.village || addr.county || addr.state || '未知位置';
    currentCityName = city;
    document.getElementById('mapLocation').textContent = data.display_name || `${lat}, ${lng}`;
    document.getElementById('cityInput').value = city;
  } catch (e) {
    document.getElementById('mapLocation').textContent = '无法解析当前位置';
  }
}

// 正地理编码（城市名 -> 坐标）
async function forwardGeocode(city) {
  const cached = getFromCache(cache.geocode, city, 12 * 60 * 60 * 1000);
  if (cached) {
    const { lat, lon, display_name } = cached;
    const latNum = parseFloat(lat), lonNum = parseFloat(lon);
    map.setView([latNum, lonNum], 12);
    updateMarker(latNum, lonNum);
    currentCityName = city;
    document.getElementById('mapLocation').textContent = display_name;
    updateWeatherByCurrentPosition();
    return;
  }
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(city)}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'zh-CN' } });
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      const first = data[0];
      setCache(cache.geocode, city, first);
      const latNum = parseFloat(first.lat), lonNum = parseFloat(first.lon);
      map.setView([latNum, lonNum], 12);
      updateMarker(latNum, lonNum);
      currentCityName = city;
      document.getElementById('mapLocation').textContent = first.display_name;
      updateWeatherByCurrentPosition();
    }
  } catch (e) { /* ignore */ }
}
const forwardGeocodeDebounced = debounce(forwardGeocode, 800);

// 自动定位
function getCurrentLocation() {
  document.getElementById('mapLocation').textContent = '正在获取位置...';
  if (navigator.geolocation) {
    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 };
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude;
        map.setView([lat, lng], 12);
        updateMarker(lat, lng);
        reverseGeocode(lat, lng);
        document.getElementById('mapLocation').textContent = '定位成功！';
        updateWeatherByCurrentPosition();
      },
      err => {
        let msg = '定位失败，请手动选择位置';
        if (err.code === err.PERMISSION_DENIED) msg = '位置权限被拒绝';
        else if (err.code === err.POSITION_UNAVAILABLE) msg = '位置信息不可用';
        else if (err.code === err.TIMEOUT) msg = '定位超时';
        document.getElementById('mapLocation').textContent = msg;
        debouncedSearchWeather();
      }, options
    );
  } else {
    document.getElementById('mapLocation').textContent = '浏览器不支持地理定位';
    debouncedSearchWeather();
  }
}

// 搜索天气（基于城市 -> 坐标 -> 天气）
function searchWeather() {
  const city = document.getElementById('cityInput').value.trim();
  if (!city) { showError('请输入城市名称'); return; }
  showLoading();
  forwardGeocodeDebounced(city);
}
const debouncedSearchWeather = debounce(searchWeather, 600);

// 基于当前坐标拉取天气（和风）
async function updateWeatherByCurrentPosition() {
  const { lat, lng } = currentPosition;
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`; // 约简精度提升缓存命中

  const cachedNow = getFromCache(cache.now, key, 10 * 60 * 1000);
  const cachedDaily = getFromCache(cache.forecast, key, 30 * 60 * 1000);
  const cachedHourly = getFromCache(cache.hourly, key, 30 * 60 * 1000);
  if (cachedNow && cachedDaily && cachedHourly) {
    displayCurrentWeather(cachedNow, currentCityName);
    displayForecast(cachedDaily);
    displayHourlyForecast(cachedHourly);
    return;
  }

  try {
    const coord = `${lng},${lat}`; // 和风要求：经度在前，纬度在后

    const [nowRes, dailyRes, hourlyRes] = await Promise.all([
      fetch(`${QWEATHER_BASE}/weather/now?location=${coord}&key=${QWEATHER_KEY}`),
      fetch(`${QWEATHER_BASE}/weather/3d?location=${coord}&key=${QWEATHER_KEY}`),
      fetch(`${QWEATHER_BASE}/weather/24h?location=${coord}&key=${QWEATHER_KEY}`)
    ]);

    const nowData = await nowRes.json();
    const dailyData = await dailyRes.json();
    const hourlyData = await hourlyRes.json();

    if (nowData.code !== '200' || dailyData.code !== '200' || hourlyData.code !== '200') {
      showError('天气服务返回错误');
      return;
    }

    const now = nowData.now || {};
    const dailyList = dailyData.daily || [];
    const hourlyList = hourlyData.hourly || [];

    setCache(cache.now, key, now);
    setCache(cache.forecast, key, dailyList);
    setCache(cache.hourly, key, hourlyList);

    displayCurrentWeather(now, currentCityName);
    displayForecast(dailyList);
    displayHourlyForecast(hourlyList);
  } catch (e) {
    showError('天气服务请求失败');
  }
}

// 渲染
function displayCurrentWeather(weather, city) {
  document.getElementById('currentCity').textContent = city;
  document.getElementById('currentTemp').textContent = weather.temp ?? '--';
  document.getElementById('currentDesc').textContent = weather.text ?? '--';
  document.getElementById('humidity').textContent = (weather.humidity ?? '--') + '%';
  document.getElementById('windSpeed').textContent = (weather.windSpeed ?? '--') + ' km/h';
  document.getElementById('pressure').textContent = (weather.pressure ?? '--') + ' hPa';
  document.getElementById('visibility').textContent = (weather.vis ?? '--') + ' km';
}
function displayForecast(forecast) {
  const forecastList = document.getElementById('forecastList');
  forecastList.innerHTML = '';
  forecast.forEach(day => {
    const date = new Date(day.fxDate);
    const dayName = getDayName(date.getDay());
    const item = document.createElement('div');
    item.className = 'forecast-item';
    item.innerHTML = `
      <div class="forecast-date">${dayName}<br>${day.fxDate}</div>
      <div class="forecast-temp">${day.tempMax}°C / ${day.tempMin}°C</div>
      <div class="forecast-desc">${day.textDay}</div>
    `;
    forecastList.appendChild(item);
  });
}
function displayHourlyForecast(hourly) {
  const hourlyList = document.getElementById('hourlyList');
  hourlyList.innerHTML = '';
  hourly.forEach(hour => {
    const time = new Date(hour.fxTime);
    const timeStr = time.getHours().toString().padStart(2, '0') + ':00';
    const item = document.createElement('div');
    item.className = 'hourly-item';
    item.innerHTML = `
      <div class="hourly-time">${timeStr}</div>
      <div class="hourly-temp">${hour.temp}°C</div>
      <div class="hourly-desc">${hour.text}</div>
      <div class="hourly-details">
        <div>湿度: ${hour.humidity ?? '--'}%</div>
        <div>风速: ${hour.windSpeed ?? '--'} km/h</div>
      </div>
    `;
    hourlyList.appendChild(item);
  });
}

function getDayName(day) {
  const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return days[day];
}

function showLoading() {
  const forecastList = document.getElementById('forecastList');
  forecastList.innerHTML = '<div class="loading">正在获取天气数据...</div>';
}
function showError(message) {
  const forecastList = document.getElementById('forecastList');
  forecastList.innerHTML = `<div class="error">${message}</div>`;
}

document.getElementById('cityInput').addEventListener('keypress', function(e) {
  if (e.key === 'Enter') debouncedSearchWeather();
}); 
