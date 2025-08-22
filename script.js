// Open-Meteo 免费天气API（无需Key，支持CORS）
const OPEN_METEO_BASE = 'https://api.open-meteo.com/v1/forecast';

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
    // 获取该位置的天气
    getWeatherByPosition(lat, lng, city);
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
    getWeatherByPosition(latNum, lonNum, city);
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
      getWeatherByPosition(latNum, lonNum, city);
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
      },
      err => {
        let msg = '定位失败，请手动选择位置';
        if (err.code === err.PERMISSION_DENIED) msg = '位置权限被拒绝';
        else if (err.code === err.POSITION_UNAVAILABLE) msg = '位置信息不可用';
        else if (err.code === err.TIMEOUT) msg = '定位超时';
        document.getElementById('mapLocation').textContent = msg;
        // 定位失败时获取默认城市天气
        getWeatherByPosition(39.9042, 116.4074, '北京');
      }, options
    );
  } else {
    document.getElementById('mapLocation').textContent = '浏览器不支持地理定位';
    getWeatherByPosition(39.9042, 116.4074, '北京');
  }
}

// 搜索天气（基于城市名称）
function searchWeather() {
  const city = document.getElementById('cityInput').value.trim();
  if (!city) { showError('请输入城市名称'); return; }
  showLoading();
  forwardGeocodeDebounced(city);
}
const debouncedSearchWeather = debounce(searchWeather, 600);

// 基于坐标获取天气（Open-Meteo）
async function getWeatherByPosition(lat, lng, cityName) {
  console.log('正在获取位置天气:', lat, lng, cityName);
  
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  
  // 先查缓存
  const cachedNow = getFromCache(cache.now, key, 10 * 60 * 1000);
  const cachedDaily = getFromCache(cache.forecast, key, 30 * 60 * 1000);
  const cachedHourly = getFromCache(cache.hourly, key, 30 * 60 * 1000);
  
  if (cachedNow && cachedDaily && cachedHourly) {
    console.log('使用缓存数据');
    displayCurrentWeather(cachedNow, cityName);
    displayForecast(cachedDaily);
    displayHourlyForecast(cachedHourly);
    return;
  }

  try {
    const params = new URLSearchParams({
      latitude: lat,
      longitude: lng,
      current_weather: 'true',
      hourly: 'temperature_2m,relativehumidity_2m,pressure_msl,windspeed_10m,visibility,weathercode',
      daily: 'temperature_2m_max,temperature_2m_min,weathercode',
      forecast_days: '3',
      timezone: 'auto'
    });
    
    const url = `${OPEN_METEO_BASE}?${params.toString()}`;
    console.log('请求天气URL:', url);
    
    const response = await fetch(url);
    const data = await response.json();
    
    console.log('天气API返回:', data);

    // 适配到现有渲染结构
    const now = adaptCurrent(data);
    const dailyList = adaptDaily(data);
    const hourlyList = adaptHourly(data);

    setCache(cache.now, key, now);
    setCache(cache.forecast, key, dailyList);
    setCache(cache.hourly, key, hourlyList);

    displayCurrentWeather(now, cityName);
    displayForecast(dailyList);
    displayHourlyForecast(hourlyList);
  } catch (error) {
    console.error('天气请求失败:', error);
    showError('天气服务请求失败');
  }
}

// 适配器：Open-Meteo -> 现有结构
function weatherCodeToText(code) {
  const m = {
    0: '晴', 1: '多云', 2: '多云', 3: '阴',
    45: '雾', 48: '雾', 51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
    56: '冻毛毛雨', 57: '冻毛毛雨', 61: '小雨', 63: '中雨', 65: '大雨',
    66: '冻雨', 67: '冻雨', 71: '小雪', 73: '中雪', 75: '大雪', 77: '雪粒',
    80: '阵雨', 81: '强阵雨', 82: '暴阵雨', 85: '阵雪', 86: '强阵雪',
    95: '雷阵雨', 96: '雷阵雨伴冰雹', 99: '强雷阵雨伴冰雹'
  };
  return m[code] || '未知';
}

function adaptCurrent(data) {
  const cw = data.current_weather || {};
  // 在 hourly 中找到与当前时间最接近的索引以取湿度/气压/能见度
  let idx = 0;
  if (data.hourly && Array.isArray(data.hourly.time)) {
    const times = data.hourly.time.map(t => new Date(t).getTime());
    const nowTs = new Date(cw.time || Date.now()).getTime();
    let best = Infinity; idx = 0;
    for (let i = 0; i < times.length; i++) {
      const diff = Math.abs(times[i] - nowTs);
      if (diff < best) { best = diff; idx = i; }
    }
  }
  const h = data.hourly || {};
  return {
    temp: cw.temperature ? Math.round(cw.temperature) : '--',
    text: weatherCodeToText(cw.weathercode),
    humidity: (h.relativehumidity_2m && h.relativehumidity_2m[idx]) ?? '--',
    pressure: (h.pressure_msl && h.pressure_msl[idx]) ?? '--',
    windSpeed: cw.windspeed ?? (h.windspeed_10m && h.windspeed_10m[idx]) ?? '--',
    vis: (h.visibility && Math.round((h.visibility[idx] || 0) / 1000)) ?? '--'
  };
}

function adaptDaily(data) {
  const daily = data.daily || {};
  const out = [];
  const len = (daily.time || []).length;
  for (let i = 0; i < len; i++) {
    out.push({
      fxDate: daily.time[i],
      tempMax: daily.temperature_2m_max ? Math.round(daily.temperature_2m_max[i]) : '--',
      tempMin: daily.temperature_2m_min ? Math.round(daily.temperature_2m_min[i]) : '--',
      textDay: weatherCodeToText(daily.weathercode ? daily.weathercode[i] : null)
    });
  }
  return out;
}

function adaptHourly(data) {
  const h = data.hourly || {};
  const out = [];
  const len = (h.time || []).length;
  for (let i = 0; i < Math.min(len, 24); i++) {
    out.push({
      fxTime: h.time[i],
      temp: h.temperature_2m ? Math.round(h.temperature_2m[i]) : '--',
      text: weatherCodeToText(h.weathercode ? h.weathercode[i] : null),
      humidity: h.relativehumidity_2m ? h.relativehumidity_2m[i] : '--',
      windSpeed: h.windspeed_10m ? h.windspeed_10m[i] : '--'
    });
  }
  return out;
}

// 渲染
function displayCurrentWeather(weather, city) {
  document.getElementById('currentCity').textContent = city;
  document.getElementById('currentTemp').textContent = weather.temp;
  document.getElementById('currentDesc').textContent = weather.text;
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
