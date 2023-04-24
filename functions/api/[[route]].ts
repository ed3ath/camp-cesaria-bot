import { Context, Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { Configuration, OpenAIApi } from 'openai'
import fetchAdapter from '@vespaiach/axios-fetch-adapter'

import Facebook, { Bindings } from '../../facebook'

import dataModels from '../../data.json'
import questions from '../../questions.json'
import admins from '../../admins.json'

let openai: any

const app = new Hono<{ Bindings: Bindings }>().basePath('/api')

const fb = new Facebook()

const guides = [
  {
    role: 'system',
    content: 'You are a helpful assistant for Camp Cesaria that answers "Frequently Asked Questions" by their customers.'
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
    fb.accessToken = c.env.FB_ACCESS_TOKEN
    fb.emit('initialized', ({ organization: c.env.OPENAI_ORG, apiKey: c.env.OPENAI_API }))
    return c.text(query['hub.challenge'], 200)
  } else {
    return c.text('', 403)
  }
})

app.post('/webhook', async (c: Context) => {
  fb.accessToken = c.env.FB_ACCESS_TOKEN
  fb.database = c.env.DB
  fb.emit('initialized', ({ organization: c.env.OPENAI_ORG, apiKey: c.env.OPENAI_API }))
  const data = await c.req.json()
  if (data.object !== 'page') {
    return c.status(404)
  }
  fb.handleFacebookData(data)
  return c.text('ok', 200)
})

fb.on('initialized', ({ organization, apiKey }) => {
  openai = new OpenAIApi(new Configuration({
    organization,
    apiKey,
    baseOptions: {
      adapter: fetchAdapter
    }
  }))
})


fb.on('message', async (payload) => {
  const senderId = payload.sender.id
  const text = payload.message.text

  if (payload.message.text) {
    if (text === 'set menu' && admins.includes(payload.sender.id)) {
      await fb.setPersistentMenu([
        { type: 'postback', title: 'FAQs', payload: 'MENU_FAQ' },
        { type: 'postback', title: 'Talk to a person', payload: 'TALK_TO_PERSON' }
      ])
      await fb.sendTextMessage(senderId, 'Menu has been set.', { typing: true })
    } else if (text === 'del menu' && admins.includes(payload.sender.id)) {
      await fb.deletePersistentMenu()
      await fb.sendTextMessage(senderId, 'Menu has been deleted.', { typing: true })
    } else if (text === 'set get started' && admins.includes(payload.sender.id)) {
      await fb.setGetStartedButton('GET_STARTED')
      await fb.sendTextMessage(senderId, 'Get Started button has been set.', { typing: true })
    } else if (text === 'del get started' && admins.includes(payload.sender.id)) {
      await fb.deletePersistentMenu()
      await fb.deleteGetStartedButton()
      await fb.sendTextMessage(senderId, 'Get Started button has been deleted.', { typing: true })
    } else {
      await sendChatPayload(senderId, [...guides,
      {
        role: 'user',
        content: text
      }
      ])
    }
  }
})


fb.on('postback', async (payload) => {
  const senderId = payload.sender.id
  const event = payload.postback.payload

  fb.sendTypingIndicator(senderId, 1000)

  if (event === 'GET_STARTED' || event === 'MENU_FAQ') {
    let user: any = await fb.database.prepare(`SELECT * FROM customers WHERE id='${senderId}'`).first()
    if (!user) {
      user = await fb.getUserProfile(senderId)
      await fb.database.prepare(`INSERT INTO customers(id, first_name, last_name, gender, talk_to_person) VALUES('${user.id}','${user.first_name}','${user.last_name}','${user.gender}', 0)`).run()
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
    await fb.sendMessage(senderId, faq, {
      typing: true
    })
  } else if (event === 'TALK_TO_PERSON') {
    await fb.sendTypingIndicator(senderId, 2000)
    await fb.database.prepare(`UPDATE customers SET talk_to_person=1 WHERE id='${senderId}'`).run()
    await fb.sendTextMessage(senderId, 'We are currently busy serving customers inside the camp. We\'re humbly asking for your patience.', {
      typing: true
    })
  }
})

fb.on('quick_reply', async (payload) => {
  const senderId = payload.sender.id
  const quickReply = payload.message.quick_reply.payload
  if (quickReply.match(/QUESTION_\w+/g)) {
    const questionIndex = quickReply.split('_')[1]
    const messages = [...guides, {
      role: 'user',
      content: questions[questionIndex]
    }]
    await sendChatPayload(senderId, messages)
  }
})

async function sendChatPayload(senderId: string, messages: any[]) {
  const response = openai.createChatCompletion({
    model: 'gpt-3.5-turbo',
    messages,
    temperature: 0,
    top_p: 1,
    frequency_penalty: 0,
    presence_penalty: 0,
    max_tokens: 1024
  })
  const reply = await response.then(async (data: any) => data.data.choices[0].message.content).catch((e: any) => {
    return 'An error occurred! Please try again later.'
  })
  fb.sendMessage(senderId, reply, {
    typing: true
  })
}


export const onRequest = handle(app)
