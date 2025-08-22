// 天气预报应用
let map;
let marker;
let currentCity = '北京';

// 页面加载时初始化
document.addEventListener('DOMContentLoaded', function() {
    initMap();
    getWeather('北京');
});

// 初始化地图
function initMap() {
    map = L.map('map').setView([39.9042, 116.4074], 10);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
    
    // 点击地图事件
    map.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;
        updateMarker(lat, lng);
        getLocationName(lat, lng);
    });
}

// 更新地图标记
function updateMarker(lat, lng) {
    if (marker) marker.remove();
    marker = L.marker([lat, lng]).addTo(map);
}

// 获取位置名称
async function getLocationName(lat, lng) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
        const data = await response.json();
        const city = data.address?.city || data.address?.town || data.address?.state || '未知位置';
        document.getElementById('mapInfo').textContent = data.display_name;
        document.getElementById('cityInput').value = city;
        getWeather(city);
    } catch (error) {
        console.error('获取位置名称失败:', error);
    }
}

// 搜索城市
function searchCity() {
    const city = document.getElementById('cityInput').value.trim();
    if (city) {
        getWeather(city);
        // 尝试获取城市坐标并更新地图
        getCityCoordinates(city);
    }
}

// 获取城市坐标
async function getCityCoordinates(city) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(city)}`);
        const data = await response.json();
        if (data.length > 0) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            map.setView([lat, lng], 12);
            updateMarker(lat, lng);
            document.getElementById('mapInfo').textContent = data[0].display_name;
        }
    } catch (error) {
        console.error('获取城市坐标失败:', error);
    }
}

// 获取我的位置
function getMyLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                map.setView([lat, lng], 12);
                updateMarker(lat, lng);
                getLocationName(lat, lng);
            },
            function(error) {
                alert('无法获取位置，请手动搜索城市');
            }
        );
    } else {
        alert('浏览器不支持地理定位');
    }
}

// 获取天气数据（使用wttr.in免费API）
async function getWeather(city) {
    showLoading();
    currentCity = city;
    
    try {
        // 获取当前天气
        const weatherResponse = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
        const weatherData = await weatherResponse.json();
        
        if (weatherData && weatherData.current_condition && weatherData.current_condition[0]) {
            displayCurrentWeather(weatherData.current_condition[0]);
        }
        
        // 获取3天预报
        if (weatherData && weatherData.weather) {
            displayForecast(weatherData.weather.slice(0, 3));
        }
        
        // 获取24小时预报
        if (weatherData && weatherData.weather && weatherData.weather[0] && weatherData.weather[0].hourly) {
            displayHourlyForecast(weatherData.weather[0].hourly);
        }
        
    } catch (error) {
        console.error('获取天气失败:', error);
        showError('获取天气数据失败，请稍后重试');
    }
}

// 显示当前天气
function displayCurrentWeather(data) {
    document.getElementById('currentCity').textContent = currentCity;
    document.getElementById('currentTemp').textContent = `${data.temp_C}°C`;
    document.getElementById('currentDesc').textContent = data.weatherDesc[0].value;
    document.getElementById('humidity').textContent = `${data.humidity}%`;
    document.getElementById('windSpeed').textContent = `${data.windspeedKmph} km/h`;
    document.getElementById('pressure').textContent = `${data.pressure} hPa`;
}

// 显示3天预报
function displayForecast(forecastData) {
    const forecastGrid = document.getElementById('forecastGrid');
    forecastGrid.innerHTML = '';
    
    forecastData.forEach(day => {
        const date = new Date(day.date);
        const dayName = getDayName(date.getDay());
        
        const forecastItem = document.createElement('div');
        forecastItem.className = 'forecast-item';
        forecastItem.innerHTML = `
            <div class="forecast-date">${dayName}</div>
            <div class="forecast-temp">${day.hourly[4].tempC}°C</div>
            <div class="forecast-desc">${day.hourly[4].weatherDesc[0].value}</div>
        `;
        forecastGrid.appendChild(forecastItem);
    });
}

// 显示24小时预报
function displayHourlyForecast(hourlyData) {
    const hourlyScroll = document.getElementById('hourlyScroll');
    hourlyScroll.innerHTML = '';
    
    hourlyData.forEach(hour => {
        const time = hour.time;
        const timeStr = time.padStart(4, '0').substring(0, 2) + ':00';
        
        const hourlyItem = document.createElement('div');
        hourlyItem.className = 'hourly-item';
        hourlyItem.innerHTML = `
            <div class="hourly-time">${timeStr}</div>
            <div class="hourly-temp">${hour.tempC}°C</div>
            <div class="hourly-desc">${hour.weatherDesc[0].value}</div>
        `;
        hourlyScroll.appendChild(hourlyItem);
    });
}

// 获取星期名称
function getDayName(day) {
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return days[day];
}

// 显示加载状态
function showLoading() {
    document.getElementById('forecastGrid').innerHTML = '<div class="loading">正在获取天气数据...</div>';
    document.getElementById('hourlyScroll').innerHTML = '';
}

// 显示错误信息
function showError(message) {
    document.getElementById('forecastGrid').innerHTML = `<div class="error">${message}</div>`;
    document.getElementById('hourlyScroll').innerHTML = '';
}

// 回车键搜索
document.getElementById('cityInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        searchCity();
    }
}); 
