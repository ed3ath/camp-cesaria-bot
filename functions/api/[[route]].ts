import { Context, Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { Configuration, OpenAIApi } from 'openai'
import fetchAdapter from '@vespaiach/axios-fetch-adapter'

import Facebook, { Bindings } from '../../facebook'

import dataModels from '../../data.json'
import questions from '../../questions.json'
import admins from '../../admins.json'

const app = new Hono<{ Bindings: Bindings }>().basePath('/api')

const fb = new Facebook()

const guides = [
  {
    role: 'system',
    content: 'You are a helpful assistant for Camp Cesaria that answers "Frequently Asked Questions" by their users.'
  }]

dataModels.forEach((model) => {
  guides.push({
    role: 'system',
    content: model
  })
})

app.get('/webhook', (c: Context) => {
  const query = c.req.query()

  if (query['hub.mode'] === 'subscribe' && query['hub.verify_token'] === c.env.FB_VERIFY_TOKEN) {
    fb.database = c.env.DB
    return c.text(query['hub.challenge'], 200)
  } else {
    return c.text('', 403)
  }
})

app.post('/webhook', async (c: Context) => {
  fb.database = c.env.DB
  const data = await c.req.json()
  const openai = new OpenAIApi(new Configuration({
    organization: c.env.OPENAI_ORG,
    apiKey: c.env.OPENAI_API,
    baseOptions: {
      adapter: fetchAdapter
    }
  }))
  if (data.object !== 'page') {
    return c.status(404)
  }
  await new Promise((resolve, reject) => {
    fb.handleFacebookData(data, async (event: string, pageId: string, data: any) => {
      const dbRes: any = await fb.database.prepare(`SELECT access_token FROM pages WHERE id='${pageId}'`).first()
      if (!dbRes) return
      if (event === 'message') {
        resolve(handleMessage(dbRes.access_token, openai, data))
      } else if (event === 'quick_reply') {
        resolve(handleQuickReply(dbRes.access_token, openai, data))
      } else if (event === 'postback') {
        resolve(handlePostback(dbRes.access_token, c.env.DB, data))
      } else if (event === 'read') {
        resolve('')
      } else if (event === 'delivery') {
        resolve('')
      } else if (event === 'account_linking') {
        resolve('')
      } else {
        reject('Webhook received unhandled event: ' + event)
      }
    })
  }).catch(console.log)

  return c.text('ok', 200)
})


async function handleMessage(accessToken: string, openai: OpenAIApi, payload: any) {
  const senderId = payload.sender.id
  const text = payload.message.text
  try {
    if (text) {
      if (text === 'set menu' && admins.includes(payload.sender.id)) {
        await fb.setPersistentMenu(accessToken, [
          { type: 'postback', title: 'FAQs', payload: 'MENU_FAQ' },
          { type: 'postback', title: 'Talk to a person', payload: 'TALK_TO_PERSON' }
        ])
        await fb.sendTextMessage(accessToken, senderId, 'Menu has been set.', { typing: true })
      } else if (text === 'del menu' && admins.includes(payload.sender.id)) {
        await fb.deletePersistentMenu(accessToken)
        await fb.sendTextMessage(accessToken, senderId, 'Menu has been deleted.', { typing: true })
      } else if (text === 'set get started' && admins.includes(payload.sender.id)) {
        await fb.setGetStartedButton(accessToken)
        await fb.sendTextMessage(accessToken, senderId, 'Get Started button has been set.', { typing: true })
      } else if (text === 'del get started' && admins.includes(payload.sender.id)) {
        await fb.deletePersistentMenu(accessToken)
        await fb.deleteGetStartedButton(accessToken)
        await fb.sendTextMessage(accessToken, senderId, 'Get Started button has been deleted.', { typing: true })
      } else {
        await sendChatPayload(accessToken, openai, senderId, [...guides,
        {
          role: 'user',
          content: text
        }
        ])
      }
    }
  } catch (e) {
    console.log(e)
  }
}


async function handlePostback(accessToken: string, database: D1Database, payload: any) {
  const senderId = payload.sender.id
  const event = payload.postback.payload

  fb.sendTypingIndicator(accessToken, senderId, 1000)

  if (event === 'GET_STARTED' || event === 'MENU_FAQ') {
    let user: any = await database.prepare(`SELECT * FROM users WHERE id='${senderId}'`).first()
    if (!user) {
      user = await fb.getUserProfile(accessToken, senderId)
      await fb.database.prepare(`INSERT INTO users(id, first_name, last_name, gender, talk_to_person) VALUES('${user.id}','${user.first_name}','${user.last_name}','${user.gender}', 0)`).run()
    }
    const faq: any = { text: `Hi ${user.gender === 'male' ? 'Sir' : 'Ma\'am'} ${user.first_name}! How may I help you?\n${questions.map((question, i) => `${i + 1}. ${question}`).join('\n')}` }
    const menus: any[] = []
    questions.forEach((_, i) => {
      menus.push({
        content_type: 'text',
        title: `Question #${i + 1}`,
        payload: `QUESTION_${i}`
      })
    })
    faq.quick_replies = menus
    await fb.sendMessage(accessToken, senderId, faq, {
      typing: true
    })
  } else if (event === 'TALK_TO_PERSON') {
    await fb.sendTypingIndicator(accessToken, senderId, 2000)
    await fb.database.prepare(`UPDATE users SET talk_to_person=1 WHERE id='${senderId}'`).run()
    await fb.sendTextMessage(accessToken, senderId, 'We are currently busy serving customers inside the camp. We\'re humbly asking for your patience.', {
      typing: true
    })
  }
}

async function handleQuickReply(accessToken: string, openai: OpenAIApi, payload: any) {
  const senderId = payload.sender.id
  const quickReply = payload.message.quick_reply.payload
  if (quickReply.match(/QUESTION_\w+/g)) {
    const questionIndex = quickReply.split('_')[1]
    const messages = [...guides, {
      role: 'user',
      content: questions[questionIndex]
    }]
    await sendChatPayload(accessToken, openai, senderId, messages)
  }
}

async function sendChatPayload(accessToken: string, openai: OpenAIApi, senderId: string, messages: any[]) {
  const reply = await openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages,
    temperature: 0,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 1024
  })
  await fb.sendMessage(accessToken, senderId, reply?.data?.choices[0].message?.content || 'I\m speechless', {
    typing: true
  })
}


export const onRequest = handle(app)
