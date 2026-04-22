import { defineRouter } from '#q-app/wrappers'
import {
  createRouter,
  createWebHistory,
} from 'vue-router'

const routes = [
  {
    path: '/',
    component: () => import('pages/IndexPage.vue')
  },
  {
    path: '/:catchAll(.*)*',
    component: () => import('pages/ErrorNotFound.vue'),
  },
]

export default defineRouter(() => {
  const Router = createRouter({
    scrollBehavior: () => ({ left: 0, top: 0 }),
    routes,

    // Leave this as is and make changes in quasar.conf.js instead!
    // quasar.conf.js -> build -> vueRouterMode
    // quasar.conf.js -> build -> publicPath
    history: createWebHistory(process.env.VUE_ROUTER_BASE),
  })

  return Router
})
