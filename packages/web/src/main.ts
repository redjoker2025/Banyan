import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './styles.css'
import { getToken } from './api'

getToken()
createApp(App).use(createPinia()).mount('#app')
