<script setup>
import { ref, toRaw } from 'vue'
const form = ref({
  username: '',
  password: ''
})

const { account } = window.electron.ipcRenderer.sendSync('getStore')
form.value = { ...account }

const close = () => {
  window.electron.ipcRenderer.send('close-config-window')
}
const save = () => {
  console.log(form.value)
  window.electron.ipcRenderer.send('save-account', toRaw(form.value))
}
</script>

<template>
  <div class="config-container">
    <div class="title">
      <img alt="logo" class="logo" src="./assets/icon.ico" />
      <span>配置EHR账户</span>
    </div>
    <input v-model="form.username" type="text" placeholder="用户名" />
    <input v-model="form.password" type="password" placeholder="密码" />
    <div class="actions">
      <div class="action">
        <a target="_blank" rel="noreferrer" @click="close">关闭</a>
      </div>
      <div class="action">
        <a class="primary" target="_blank" rel="noreferrer" @click="save">保存</a>
      </div>
    </div>
  </div>
</template>
