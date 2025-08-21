// 和风天气API配置
const API_KEY = 'a19494ae0d1e6e17e05c79b0c86b6185';
const BASE_URL = 'https://devapi.qweather.com/v7';

// 简单内存缓存（带TTL）
const cache = {
    now: new Map(),         // city -> { value, time }
    forecast: new Map(),    // city -> { value, time }
    hourly: new Map(),      // city -> { value, time }
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

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    // 页面加载时自动定位
    getCurrentLocation();
});

// 初始化Leaflet地图
function initMap() {
    map = L.map('map').setView([currentPosition.lat, currentPosition.lng], 10);
    
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);

    map.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        updateMarker(lat, lng);
        reverseGeocode(lat, lng);
    });
}

// 更新地图标记
function updateMarker(lat, lng) {
    if (marker) {
        marker.remove();
    }
    marker = L.marker([lat, lng]).addTo(map);
    currentPosition = { lat, lng };
}

// 使用Nominatim逆地理编码（坐标 -> 地址/城市）
async function reverseGeocode(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'zh-CN' } });
        const data = await res.json();
        const addr = data.address || {};
        const city = addr.city || addr.town || addr.village || addr.county || addr.state || '未知位置';
        document.getElementById('mapLocation').textContent = data.display_name || `${lat}, ${lng}`;
        document.getElementById('cityInput').value = city;
        debouncedSearchWeather();
    } catch (e) {
        document.getElementById('mapLocation').textContent = '无法解析当前位置';
    }
}

// 使用Nominatim正地理编码（城市名 -> 坐标），并更新地图
async function forwardGeocode(city) {
    // 先查缓存（12小时）
    const cached = getFromCache(cache.geocode, city, 12 * 60 * 60 * 1000);
    if (cached) {
        const { lat, lon, display_name } = cached;
        const latNum = parseFloat(lat);
        const lonNum = parseFloat(lon);
        map.setView([latNum, lonNum], 12);
        updateMarker(latNum, lonNum);
        document.getElementById('mapLocation').textContent = display_name;
        return;
    }
    try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(city)}`;
        const res = await fetch(url, { headers: { 'Accept-Language': 'zh-CN' } });
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
            const first = data[0];
            setCache(cache.geocode, city, first);
            const { lat, lon } = first;
            const latNum = parseFloat(lat);
            const lonNum = parseFloat(lon);
            map.setView([latNum, lonNum], 12);
            updateMarker(latNum, lonNum);
            document.getElementById('mapLocation').textContent = first.display_name;
        }
    } catch (e) {
        // 忽略错误
    }
}
const forwardGeocodeDebounced = debounce(forwardGeocode, 800);

// 获取当前位置（优化版）
function getCurrentLocation() {
    document.getElementById('mapLocation').textContent = '正在获取位置...';
    if (navigator.geolocation) {
        const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 };
        navigator.geolocation.getCurrentPosition(
            pos => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
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
                // 定位失败时，按当前输入城市获取天气
                debouncedSearchWeather();
            },
            options
        );
    } else {
        document.getElementById('mapLocation').textContent = '浏览器不支持地理定位';
        debouncedSearchWeather();
    }
}

// 搜索天气函数
function searchWeather() {
    const cityInput = document.getElementById('cityInput');
    const city = cityInput.value.trim();
    if (!city) {
        showError('请输入城市名称');
        return;
    }
    showLoading();
    // 天气
    getCurrentWeather(city);
    getForecast(city);
    getHourlyForecast(city);
    // 地图同步（去抖）
    forwardGeocodeDebounced(city);
}
const debouncedSearchWeather = debounce(searchWeather, 600);

// 使用JSONP方式获取实时天气
function getCurrentWeather(city) {
    // 先查缓存（10分钟）
    const cached = getFromCache(cache.now, city, 10 * 60 * 1000);
    if (cached) {
        displayCurrentWeather(cached, city);
        return;
    }
    const script = document.createElement('script');
    const callbackName = 'weatherCallback_' + Date.now();
    window[callbackName] = function(data) {
        if (data && data.code === '200') {
            setCache(cache.now, city, data.now);
            displayCurrentWeather(data.now, city);
        } else {
            showError('获取实时天气失败');
        }
        document.head.removeChild(script);
        delete window[callbackName];
    };
    script.src = `${BASE_URL}/weather/now?location=${encodeURIComponent(city)}&key=${API_KEY}&callback=${callbackName}`;
    document.head.appendChild(script);
    setTimeout(() => {
        if (window[callbackName]) {
            showError('获取实时天气超时');
            document.head.removeChild(script);
            delete window[callbackName];
        }
    }, 10000);
}

// 使用JSONP方式获取3天预报
function getForecast(city) {
    // 先查缓存（30分钟）
    const cached = getFromCache(cache.forecast, city, 30 * 60 * 1000);
    if (cached) {
        displayForecast(cached);
        return;
    }
    const script = document.createElement('script');
    const callbackName = 'forecastCallback_' + Date.now();
    window[callbackName] = function(data) {
        if (data && data.code === '200') {
            setCache(cache.forecast, city, data.daily);
            displayForecast(data.daily);
        } else {
            showError('获取天气预报失败');
        }
        document.head.removeChild(script);
        delete window[callbackName];
    };
    script.src = `${BASE_URL}/weather/3d?location=${encodeURIComponent(city)}&key=${API_KEY}&callback=${callbackName}`;
    document.head.appendChild(script);
    setTimeout(() => {
        if (window[callbackName]) {
            showError('获取天气预报超时');
            document.head.removeChild(script);
            delete window[callbackName];
        }
    }, 10000);
}

// 获取24小时预报
function getHourlyForecast(city) {
    // 先查缓存（30分钟）
    const cached = getFromCache(cache.hourly, city, 30 * 60 * 1000);
    if (cached) {
        displayHourlyForecast(cached);
        return;
    }
    const script = document.createElement('script');
    const callbackName = 'hourlyCallback_' + Date.now();
    window[callbackName] = function(data) {
        if (data && data.code === '200') {
            setCache(cache.hourly, city, data.hourly);
            displayHourlyForecast(data.hourly);
        }
        document.head.removeChild(script);
        delete window[callbackName];
    };
    script.src = `${BASE_URL}/weather/24h?location=${encodeURIComponent(city)}&key=${API_KEY}&callback=${callbackName}`;
    document.head.appendChild(script);
    setTimeout(() => {
        if (window[callbackName]) {
            document.head.removeChild(script);
            delete window[callbackName];
        }
    }, 10000);
}

// 显示实时天气
function displayCurrentWeather(weather, city) {
    document.getElementById('currentCity').textContent = city;
    document.getElementById('currentTemp').textContent = weather.temp;
    document.getElementById('currentDesc').textContent = weather.text;
    document.getElementById('humidity').textContent = weather.humidity + '%';
    document.getElementById('windSpeed').textContent = weather.windSpeed + ' km/h';
    document.getElementById('pressure').textContent = weather.pressure + ' hPa';
    document.getElementById('visibility').textContent = weather.vis + ' km';
}

// 显示天气预报
function displayForecast(forecast) {
    const forecastList = document.getElementById('forecastList');
    forecastList.innerHTML = '';
    forecast.forEach(day => {
        const date = new Date(day.fxDate);
        const dayName = getDayName(date.getDay());
        const forecastItem = document.createElement('div');
        forecastItem.className = 'forecast-item';
        forecastItem.innerHTML = `
            <div class="forecast-date">${dayName}<br>${day.fxDate}</div>
            <div class="forecast-temp">${day.tempMax}°C / ${day.tempMin}°C</div>
            <div class="forecast-desc">${day.textDay}</div>
            <div class="forecast-details">
                <div>湿度: ${day.humidity || '--'}%</div>
                <div>风速: ${day.windSpeedDay || '--'} km/h</div>
            </div>
        `;
        forecastList.appendChild(forecastItem);
    });
}

// 显示24小时预报
function displayHourlyForecast(hourly) {
    const hourlyList = document.getElementById('hourlyList');
    hourlyList.innerHTML = '';
    hourly.forEach(hour => {
        const time = new Date(hour.fxTime);
        const timeStr = time.getHours() + ':00';
        const hourlyItem = document.createElement('div');
        hourlyItem.className = 'hourly-item';
        hourlyItem.innerHTML = `
            <div class="hourly-time">${timeStr}</div>
            <div class="hourly-temp">${hour.temp}°C</div>
            <div class="hourly-desc">${hour.text}</div>
            <div class="hourly-details">
                <div>湿度: ${hour.humidity || '--'}%</div>
                <div>风速: ${hour.windSpeed || '--'} km/h</div>
            </div>
        `;
        hourlyList.appendChild(hourlyItem);
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
    if (e.key === 'Enter') {
        debouncedSearchWeather();
    }
}); 
