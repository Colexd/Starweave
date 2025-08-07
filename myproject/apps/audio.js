import WebSocket from 'ws'
import crypto from 'crypto'
import { URLSearchParams } from 'url'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const STATUS_FIRST_FRAME = 0  // 第一帧的标识
const STATUS_CONTINUE_FRAME = 1  // 中间帧标识
const STATUS_LAST_FRAME = 2  // 最后一帧的标识

export class Ws_Param {
  constructor(APPID, APIKey, APISecret, Text, res_id) {
    this.APPID = APPID
    this.APIKey = APIKey
    this.APISecret = APISecret
    this.Text = Text
    this.CommonArgs = { "app_id": this.APPID, "res_id": res_id, "status": 2 }
    this.BusinessArgs = {
      "tts": {
        "rhy": 1,
        "vcn": "x5_clone",
        "volume": 50,
        "pybuffer": 1,
        "speed": 50,
        "pitch": 50,
        "bgs": 0,
        "reg": 0,
        "rdn": 0,
        "audio": {
          "encoding": "lame",
          "sample_rate": 16000,
          "channels": 1,
          "bit_depth": 16,
          "frame_size": 0
        },
        "pybuf": {
          "encoding": "utf8",
          "compress": "raw",
          "format": "plain"
        }
      }
    }
    this.Data = {
      "text": {
        "encoding": "utf8",
        "compress": "raw",
        "format": "plain",
        "status": 2,
        "seq": 0,
        "text": Buffer.from(this.Text || '').toString('base64')
      }
    }
  }
}

export function assembleWsAuthUrl(requset_url, method = "GET", api_key = "", api_secret = "") {
  const url = new URL(requset_url)
  const host = url.host
  const path = url.pathname
  const now = new Date()
  const date = now.toUTCString()

  const signatureOrigin = `host: ${host}\ndate: ${date}\n${method} ${path} HTTP/1.1`
  const signatureSha = crypto.createHmac('sha256', api_secret).update(signatureOrigin).digest('base64')
  const authorizationOrigin = `api_key="${api_key}", algorithm="hmac-sha256", headers="host date request-line", signature="${signatureSha}"`
  const authorization = Buffer.from(authorizationOrigin).toString('base64')

  const values = new URLSearchParams({
    host: host,
    date: date,
    authorization: authorization
  })

  return `${requset_url}?${values.toString()}`
}

export function onMessage(ws, message) {
  try {
    const data = JSON.parse(message)
    const code = data.header.code
    const sid = data.header.sid

    if (data.payload) {
      const audio = data.payload.audio.audio
      const audioBuffer = Buffer.from(audio, 'base64')
      const status = data.payload.audio.status

      if (status === 2) {
        console.log("ws is closed")
        ws.close()
      }
      if (code !== 0) {
        const errMsg = data.message
        console.error(`sid:${sid} call error:${errMsg} code is:${code}`)
      } else {
        const filePath = path.join(__dirname, 'demo.mp3')
        fs.appendFileSync(filePath, audioBuffer)
      }
    }
  } catch (e) {
    console.error("receive msg,but parse exception:", e)
  }
}

export function onError(ws, error) {
  console.error("### error:", error)
}

export function onClose(ws) {
  console.log("### closed ###")
}

export function onOpen(ws, wsParam) {
  const data = {
    header: wsParam.CommonArgs,
    parameter: wsParam.BusinessArgs,
    payload: wsParam.Data,
  }
  console.log("------>开始发送文本数据")
  ws.send(JSON.stringify(data))
  const filePath = path.join(__dirname, 'demo.mp3')
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath)
  }
}

export async function synthesizeAudio(textToSynthesize) {
  return new Promise((resolve, reject) => {
    const res_id = '2cf7bfb_ttsclone-e9e3d9d7-mawlx'
    const appid = 'e9e3d9d7'
    const apisecret = 'ZjU5MmNmZTM4N2JkMWQ0MGQ0NzllOTEz'
    const apikey = '285e3927154109041102282c61ee54f7'

    const wsParam = new Ws_Param(appid, apisecret, apikey, textToSynthesize, res_id)
    const requrl = 'wss://cn-huabei-1.xf-yun.com/v1/private/voice_clone'
    const wsUrl = assembleWsAuthUrl(requrl, "GET", apikey, apisecret)

    const ws = new WebSocket(wsUrl)

    ws.onopen = () => onOpen(ws, wsParam)
    ws.onmessage = (event) => {
      onMessage(ws, event.data)
      const data = JSON.parse(event.data)
      if (data.payload && data.payload.audio.status === 2) {
        // Last frame received, resolve the promise
        resolve(path.join(__dirname, 'demo.mp3'))
      }
    }
    ws.onerror = (error) => {
      onError(ws, error)
      reject(error)
    }
    ws.onclose = () => onClose(ws)
  })
}