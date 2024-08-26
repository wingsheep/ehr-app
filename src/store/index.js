import Store from 'electron-store'

const store = new Store({
  defaults: {
    account: {
      username: '',
      password: ''
    },
    showMainWindow: true
  }
})

export default store
