import {
  app,
  dialog,
  BrowserWindow,
  Tray,
  Menu,
  nativeTheme,
  nativeImage,
  Notification,
  ipcMain
} from 'electron'
import puppeteer from 'puppeteer-core'
import path from 'node:path'
import pie from 'puppeteer-in-electron'
import { fileURLToPath } from 'url'
import store from '../store/index.js'
import appIcon from '../../build/icon.png?asset'
import { platform } from 'node:os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let tray = null
let mainWindow = null
let intervalId = null
let isLoginAttempted = false // 标记是否已尝试过登录
let configWindow = null
let userInfo = null
let offDutyTime = null
let startWorkTime = null
let contextMenu = null
// 在状态栏添加图标
function createTray() {
  const icon = nativeImage.createFromPath(appIcon)
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  createContextMenu()
  tray.on('click', () => {
    if (process.platform === 'win32') {
      tray?.popUpContextMenu(contextMenu)
    }
  })
  return tray
}
// 创建托盘菜单
function createContextMenu() {
  contextMenu = Menu.buildFromTemplate([
    {
      label: `登录账户: ${userInfo?.userName}`,
      visible: !!userInfo?.userName,
      enabled: false
    },
    {
      label: `打卡时间: ${startWorkTime || '未打卡'}`,
      visible: !!userInfo?.userName,
      enabled: false
    },
    {
      label: `下班时间: ${offDutyTime || ''}`,
      visible: !!userInfo?.userName,
      enabled: false
    },
    {
      type: 'separator'
    },
    {
      label: '打开',
      click: () => {
        if (!mainWindow) {
          createWindow()
        } else {
          mainWindow.show()
        }
      }
    },
    {
      label: '显示窗口',
      type: 'checkbox', // 设置菜单项为 checkbox
      checked: store.get('showMainWindow', true), // 读取 store 中的状态
      click: (menuItem) => {
        const checked = menuItem.checked
        store.set('showMainWindow', checked)
        resetWindow()
      }
    },

    {
      label: '刷新数据',
      click: () => {
        resetWindow()
      }
    },
    {
      type: 'separator'
    },
    {
      label: '配置账户',
      click: () => {
        createConfigWindow()
      }
    },
    {
      label: '重新登录',
      toolTip: '根据配置账户自动登录',
      visible: true,
      click: () => {
        againLogin()
      }
    },
    {
      label: '退出登录',
      visible: !!userInfo?.userName,
      click: () => {
        logout()
      }
    },
    {
      type: 'separator'
    },
    {
      label: '退出',
      click: () => {
        app.isQuiting = true
        if (tray) tray.destroy()
        app.quit()
      }
    }
  ])
  tray?.setContextMenu(contextMenu)
}
// 初始化puppeteer pie
;(async () => {
  await pie.initialize(app)
})()

// 模拟登录
async function againLogin() {
  const account = store.get('account')
  if (account?.username && account?.password) {
    isLoginAttempted = false
    userInfo = null
    await clearCookiesAndStorage()
    store.set('showMainWindow', true)
    await resetWindow()
  } else {
    // 弹提示请先配置
    dialog
      .showMessageBox({
        title: '提示',
        message: '请先配置账户',
        buttons: ['确定', '取消']
      })
      .then((result) => {
        if (result.response === 1) return
        createConfigWindow()
      })
  }
}
// 退出登录
async function logout() {
  isLoginAttempted = true
  userInfo = null
  intervalId && clearInterval(intervalId)
  setTrayText('未登录')
  store.set('showMainWindow', true)
  await clearCookiesAndStorage()
  await resetWindow()
}
// 清除 Cookies 和 localStorage 退出登录
async function clearCookiesAndStorage() {
  if (mainWindow) {
    // 清除 Cookies
    const { session } = mainWindow.webContents
    await session.clearStorageData({
      storages: ['cookies']
    })

    // 清除 localStorage
    await mainWindow.webContents.executeJavaScript(`
      localStorage.clear();
      sessionStorage.clear();
    `)
  }
}

// 创建配置窗口
function createConfigWindow() {
  configWindow = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  configWindow.setMenu(null)
  process.env.NODE_ENV === 'development' && configWindow.webContents.openDevTools()

  // configWindow.loadFile('form.html')
  // Load the local URL for development or the local
  // html file for production
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    configWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    configWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  configWindow.on('closed', () => {
    configWindow = null
    createContextMenu()
  })
}

ipcMain.on('setStore', (_, key, value) => {
  store.set(key, value)
})

ipcMain.on('getStore', (_, key) => {
  let value = store.get(key)
  _.returnValue = value || ''
})

ipcMain.on('save-account', (event, account) => {
  store.set('account', account) // 更新 store 中的账户信息
  if (configWindow) {
    configWindow.close() // 关闭配置窗口
  }
})

ipcMain.on('close-config-window', () => {
  if (configWindow) {
    configWindow.close()
  }
})
function setTrayText(text) {
  if (tray) {
    tray.setTitle(text)
    process.platform === 'win32' && tray.setToolTip(text)
  }
}
// 计算下班时间
function addHoursToDateTime(baseDateTime, hoursToAdd = 9.5) {
  const [datePart, timePart] = baseDateTime.split(' ')
  const [year, month, day] = datePart.split('/')
  let [hours, minutes, seconds] = timePart.split(':')
  // 如果小于8:30则重置为8:30
  if (parseInt(hours) <= 8 && parseInt(minutes) < 30) {
    hours = '08'
    minutes = '30'
    seconds = '00'
  }
  const dateTime = new Date(year, month - 1, day, hours, minutes, seconds)
  const resultDateTime = new Date(dateTime.getTime() + hoursToAdd * 3600000)

  const yyyy = resultDateTime.getFullYear()
  const MM = String(resultDateTime.getMonth() + 1).padStart(2, '0')
  const dd = String(resultDateTime.getDate()).padStart(2, '0')
  const HH = String(resultDateTime.getHours()).padStart(2, '0')
  const mm = String(resultDateTime.getMinutes()).padStart(2, '0')
  const ss = String(resultDateTime.getSeconds()).padStart(2, '0')

  return `${yyyy}/${MM}/${dd} ${HH}:${mm}:${ss}`
}
// 创建窗口
async function createWindow() {
  mainWindow = new BrowserWindow({
    show: store.get('showMainWindow', true),
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true, // 启用上下文隔离
      enableRemoteModule: false, // 禁用远程模块
      nodeIntegration: false // 禁用Node.js集成
    }
  })
  mainWindow.setMenu(null)
  const browser = await pie.connect(app, puppeteer)
  mainWindow.loadURL('https://www.italent.cn')
  process.env.NODE_ENV === 'development' && mainWindow.webContents.openDevTools()
  mainWindow.webContents.on('did-finish-load', async () => {
    try {
      const { isLogin, start, end, loginUserInfo } = await mainWindow.webContents
        .executeJavaScript(`
        (async () => {
          try {
            console.log(BSGlobal.loginUserInfo)
            if (!BSGlobal.loginUserInfo) {
              return {
                loginUserInfo: null,
                isLogin: false
              }
            }
            function getTodayRange(symbol) {
              const today = new Date();
              const yyyy = today.getFullYear();
              const MM = String(today.getMonth() + 1).padStart(2, '0');
              const dd = String(today.getDate()).padStart(2, '0');
              const dateStr = yyyy + '/' + MM + '/' + dd
              return dateStr + symbol + dateStr
            }
            const res = await fetch("https://cloud.italent.cn/api/v2/UI/TableList?viewName=Attendance.SingleObjectListView.EmpAttendanceDataList&metaObjName=Attendance.AttendanceStatistics&app=Attendance&PaaS-SourceApp=Attendance&PaaS-CurrentView=Attendance.AttendanceDataRecordNavView&shadow_context=%7BappModel%3A%22italent%22%2Cuppid%3A%221%22%7D", {
              headers: {
                "accept": "application/json, application/xml, text/play, text/html, */*",
                "accept-language": "zh-CN,zh;q=0.9,en;q=0.8",
                "content-type": "application/json; charset=utf-8",
                "eagleeye-traceid": "0bf639ae-8db9-4d21-a35e-4021864b0337",
                "sec-ch-ua": \`"Not/A)Brand";v="8", "Chromium";v="126"\`,
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": \`"macOS"\`,
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-site",
                "x-sourced-by": "ajax",
                "Referer": "https://www.italent.cn/",
              },
              body: JSON.stringify({
                search_data: {
                  metaObjName: "Attendance.AttendanceStatistics",
                  searchView: "Attendance.EmpAttendanceDataSearch",
                  items: [
                    { name: "Attendance.AttendanceStatistics.StaffId", text: BSGlobal.loginUserInfo.userName + '(' + BSGlobal.loginUserInfo.email + ')', value: BSGlobal.loginUserInfo.Id, num: "1", metaObjName: "", metaFieldRelationIDPath: "", queryAreaSubNodes: false },
                    { name: "Attendance.AttendanceStatistics.StdIsDeleted", text: "否", value: "0", num: "5", metaObjName: "", metaFieldRelationIDPath: "", queryAreaSubNodes: false },
                    { name: "Attendance.AttendanceStatistics.Status", text: "启用", value: "1", num: "6", metaObjName: "", metaFieldRelationIDPath: "", queryAreaSubNodes: false },
                    {
                      metaFieldRelationIDPath: "",
                      metaObjName: "",
                      name: "Attendance.AttendanceStatistics.SwipingCardDate",
                      num: "2",
                      queryAreaSubNodes: false,
                      text: getTodayRange('~'),
                      value: getTodayRange('-')
                    }
                  ],
                  searchFormFilterJson: null
                }
              }),
              method: "POST"
            });
            if (!res.ok) return null;
            const resJson = await res.json();
            const { ActualForFirstCard, ActualForLastCard } = resJson?.biz_data[0];
            return {
              start: ActualForFirstCard?.value,
              end: ActualForLastCard?.value,
              loginUserInfo: BSGlobal.loginUserInfo,
              isLogin: true
            }
          } catch (error) {
            console.error('Error fetching data:', error);
            return error
          }
        })();
      `)
      if (!isLogin) {
        console.log('isLoginAttempted', isLoginAttempted)
        if (!isLoginAttempted) {
          // 第一次登录
          isLoginAttempted = true // 设置标记，避免重复登录
          const currentURL = mainWindow.webContents.getURL()
          const loginUrl = 'https://www.italent.cn/Login'
          if (currentURL !== loginUrl) {
            mainWindow.loadURL(loginUrl)
          } else {
            mockLogin(browser)
          }
          mainWindow.webContents.on('did-finish-load', async () => {
            console.log('did-finish-load  login')
            mockLogin(browser)
          })
        }
        intervalId && clearInterval(intervalId)
        setTrayText('未登录')
        return false
      }
      userInfo = loginUserInfo
      startWorkTime = start
      createContextMenu()
      if (!start) return setTrayText('暂无数据，点击刷新')
      if (end) {
        return setTrayText(`昨日下班已打卡：${end.split(' ')[1]}`)
      }
      offDutyTime = addHoursToDateTime(start)
      createContextMenu()
      const getShowStr = (text, timeDifference) => {
        const hours = Math.floor((timeDifference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
        const minutes = Math.floor((timeDifference % (1000 * 60 * 60)) / (1000 * 60))
        const seconds = Math.floor((timeDifference % (1000 * 60)) / 1000)
        const _hours = hours < 10 ? '0' + hours : hours
        const _minutes = minutes < 10 ? '0' + minutes : minutes
        const _seconds = seconds < 10 ? '0' + seconds : seconds
        const srt = `${text}：${_hours}:${_minutes}:${_seconds}`
        return srt
      }
      const targetDate = new Date(offDutyTime).getTime()
      let hasShownEndMessage = false
      let haveGotSupper = false
      intervalId && clearInterval(intervalId)
      // 更新倒计时的函数
      // eslint-disable-next-line no-inner-declarations
      function updateCountdown() {
        const now = new Date().getTime()
        const timeRemaining = targetDate - now
        const tolerance = 1000 // 允许1秒的误差范围
        if (timeRemaining > tolerance) {
          setTrayText(getShowStr('距离下班还有', timeRemaining))
          hasShownEndMessage = false
        } else if (timeRemaining <= tolerance && timeRemaining > -tolerance) {
          if (!hasShownEndMessage) {
            setTrayText('今日工时已达标')
            new Notification({
              title: '今日工时已达标',
              body: '下班别忘记打卡哦~'
            }).show()
            hasShownEndMessage = true
          }
        } else {
          const overtimeHours = now - targetDate
          setTrayText(getShowStr('你已加班', overtimeHours))
          hasShownEndMessage = false
          // 如果加班了一个半小时，如果在一分钟内通知一下
          if (overtimeHours / 1000 / 60 > 90 && overtimeHours / 1000 / 60 < 91) {
            if (!haveGotSupper) {
              new Notification({
                title: '加班餐成就 +1',
                body: '你已加班一个半小时，赶快下班吧~'
              }).show()
              haveGotSupper = true
            }
          }
          // 如果当天时间是23:59:59，判断清除定时器
          if (
            new Date().getHours() === 23 &&
            new Date().getMinutes() === 59 &&
            new Date().getSeconds() === 59
          ) {
            intervalId && clearInterval(intervalId)
            resetWindow()
          }
        }
      }
      updateCountdown()
      intervalId = setInterval(updateCountdown, 1000)
    } catch (error) {
      console.error('Error executing script:', error)
    }
  })
  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault()
      mainWindow.hide()
    }
    return true
  })
}
// 模拟登录
async function mockLogin(browser) {
  const account = store.get('account')
  const username = account?.username || ''
  const password = account?.password || ''
  const page = await pie.getPage(browser, mainWindow)
  // await page.goto('https://www.italent.cn/Login'); // 再次加载确保页面已完全加载
  await page.waitForSelector('#form-item-account')
  // 填写用户名
  await page.type('#form-item-account', username)
  // 填写密码
  await page.type('#form-item-password', password)
  // 勾选协议复选框
  await page.click('.phoenix-checkbox__input')
  // 点击登录按钮
  await page.click('.login-home-ft .phoenix-button')

  await page.waitForNavigation() // 等待页面加载完成
  // 关闭 Puppeteer 实例
  await browser.disconnect()
  isLoginAttempted = false
}
// 设置一个间隔任务，每早10点刷新一次窗口
function scheduleTask() {
  const now = new Date()
  const targetTime = new Date()
  targetTime.setHours(10, 0, 0, 0)
  if (now > targetTime) {
    targetTime.setDate(targetTime.getDate() + 1)
  }
  const timeDifference = targetTime.getTime() - now.getTime()
  setTimeout(() => {
    resetWindow()
    setInterval(
      () => {
        resetWindow()
      },
      24 * 60 * 60 * 1000
    )
  }, timeDifference)
}

// 重建窗口
function resetWindow() {
  if (mainWindow) {
    mainWindow.close()
  }
  setTrayText('加载中...')
  createWindow()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createTray()
  createWindow()
  scheduleTask()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  if (process.platform === 'darwin') {
    app.dock.hide()
  }
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.

// 监听主题变化
nativeTheme.on('updated', () => {})
