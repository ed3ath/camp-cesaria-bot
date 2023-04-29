export type Bindings = {
    FB_APP_SECRET: string
    FB_VERIFY_TOKEN: string
    ENC_KEY: string
    OPENAI_ORG: string
    OPENAI_API: string
    DB: D1Database
}

class Facebook {
    broadcastEchoes: boolean
    graphApiVersion: string
    database!: D1Database


    constructor(options: any | undefined = {}) {
        this.broadcastEchoes = options.broadcastEchoes || false
        this.graphApiVersion = options.graphApiVersion || 'v2.12'
    }

    async sendRequest(accessToken: string, body: any, endpoint: string = 'messages', method: string = 'POST') {
        try {
            const res = await fetch(`https://graph.facebook.com/${this.graphApiVersion}/me/${endpoint}?access_token=${accessToken}`, {
                method,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            })
            const res_1: any = await res.json()
            if (res_1.error) {
                console.log('Messenger Error received. For more information about error codes, see: https://goo.gl/d76uvB')
                console.log(res_1.error)
            }
            return res_1
        } catch (err) {
            return console.log(`Error sending message: ${err}`)
        }
    }

    handleFacebookData(data: any, cb: any) {
        data.entry.forEach((entry: any) => {
            const pageId = entry.id
            entry.messaging.forEach((event: any) => {
                if (event.message && event.message.is_echo && !this.broadcastEchoes) {
                    return
                }
                if (event.message && event.message.text) {
                    if (event.message.quick_reply) {
                        cb('quick_reply', pageId, event)
                    } else {
                        cb('message', pageId, event)
                    }
                } else if (event.postback) {
                    cb('postback', pageId, event)
                } else if (event.read) {
                    cb('read', pageId, event)
                } else if (event.delivery) {
                    cb('delivery', pageId, event)
                } else if (event.account_linking) {
                    cb('account_linking', pageId, event)
                } else if (event.referral) {
                    cb('referral', pageId, event)
                } else {
                    console.log('Webhook received unknown event: ', event)
                }
            })
        })
    }

    sendTextMessage(accessToken: string, recipientId: object | string, message: any, options: any = {}) {
        if (message.quick_replies && message.quick_replies.length > 0) {
            message.quick_replies = this._formatQuickReplies(message.quick_replies)
        }
        return this.sendMessage(accessToken, recipientId, message, options)
    }

    async sendMessage(accessToken: string, recipientId: object | string, message: any, options: any = {}) {
        const recipient = this._createRecipient(recipientId)
        const messagingType = options && options.messagingType
        const notificationType = options && options.notificationType
        const tag = options && options.tag
        const reqBody: any = {
            recipient,
            message: typeof message === 'object' ? message : { text: message },
            messaging_type: messagingType || 'RESPONSE'
        }

        if (notificationType) {
            reqBody.notification_type = notificationType
        }
        if (tag) {
            reqBody.tag = tag
        }
        if (options && options.typing) {
            const autoTimeout = (message && message.text) ? message.text.length * 10 : 1000
            const timeout = (typeof options.typing === 'number') ? options.typing : autoTimeout
            await this.sendTypingIndicator(accessToken, recipientId, timeout)
        }
        return this.sendRequest(accessToken, reqBody)
    }

    sendTypingIndicator(accessToken: string, recipientId: object | string, milliseconds: number) {
        const timeout = isNaN(milliseconds) ? 0 : milliseconds
        if (milliseconds > 20000) {
            milliseconds = 20000
            console.error('sendTypingIndicator: max milliseconds value is 20000 (20 seconds)')
        }
        return new Promise(async (resolve, reject) => {
            await this.sendAction(accessToken, recipientId, 'typing_on')
            setTimeout(() => this.sendAction(accessToken, recipientId, 'typing_off').then((json) => resolve(json)), timeout)
        })
    }

    sendProfileRequest(accessToken: string, body: any, method = 'POST') {
        return this.sendRequest(accessToken, body, 'messenger_profile', method)
    }

    setGetStartedButton(accessToken: string) {
        return this.sendProfileRequest(accessToken, {
            get_started: {
                payload: 'GET_STARTED'
            }
        })
    }

    deleteGetStartedButton(accessToken: string) {
        return this.sendProfileRequest(accessToken, {
            fields: [
                'get_started'
            ]
        }, 'DELETE')
    }

    setPersistentMenu(accessToken: string, buttons: any[], disableInput = false) {
        if (buttons && buttons[0] && buttons[0].locale !== undefined) {
            // Received an array of locales, send it as-is.
            return this.sendProfileRequest(accessToken, { persistent_menu: buttons })
        }
        // If it's not an array of locales, we'll assume is an array of buttons.
        const formattedButtons = this._formatButtons(buttons)
        return this.sendProfileRequest(accessToken, {
            persistent_menu: [{
                locale: 'default',
                composer_input_disabled: disableInput,
                call_to_actions: formattedButtons
            }]
        })
    }

    deletePersistentMenu(accessToken: string) {
        return this.sendProfileRequest(accessToken, {
            fields: [
                'persistent_menu'
            ]
        }, 'DELETE')
    }

    sendAction(accessToken: string, recipientId: object | string, action: any) {
        const recipient = this._createRecipient(recipientId)
        return this.sendRequest(accessToken, {
            recipient,
            sender_action: action
        })
    }

    async getUserProfile(userId: string, accessToken: string) {
        const url = `https://graph.facebook.com/${this.graphApiVersion}/${userId}?fields=first_name,last_name,gender&access_token=${accessToken}`
        try {
            const res = await fetch(url)
            return await res.json()
        } catch (err) {
            return console.log(`Error getting user profile: ${err}`)
        }
    }

    _createRecipient(recipient: object | string) {
        return (typeof recipient === 'object') ? recipient : { id: recipient }
    }

    _formatQuickReplies(quickReplies: any[]) {
        return quickReplies && quickReplies.map((reply) => {
            if (typeof reply === 'string') {
                return {
                    content_type: 'text',
                    title: reply,
                    payload: 'QUICK_REPLY_' + this._normalizeString(reply)
                }
            } else if (reply && reply.title) {
                return Object.assign({
                    content_type: 'text',
                    payload: 'QUICK_REPLY_' + this._normalizeString(reply.title)
                }, reply)
            }
            return reply
        })
    }

    _formatButtons(buttons: any[]) {
        return buttons && buttons.map((button) => {
            if (typeof button === 'string') {
                return {
                    type: 'postback',
                    title: button,
                    payload: 'BUTTON_' + this._normalizeString(button)
                }
            } else if (button && button.type) {
                return button
            }
            return {}
        })
    }

    _normalizeString(str: any) {
        return str.replace(/[^a-zA-Z0-9]+/g, '').toUpperCase()
    }

}

export default Facebook