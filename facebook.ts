export type Bindings = {
    FB_ACCESS_TOKEN: string
    FB_APP_SECRET: string
    FB_VERIFY_TOKEN: string
    OPENAI_ORG: string
    OPENAI_API: string
    DB: D1Database
}

class Facebook {
    broadcastEchoes: boolean
    graphApiVersion: string
    accessToken: string
    database!: D1Database


    constructor(options: any | undefined = {}) {
        this.accessToken = ''
        this.broadcastEchoes = options.broadcastEchoes || false
        this.graphApiVersion = options.graphApiVersion || 'v2.12'
    }

    async sendRequest(body: any, endpoint: string = 'messages', method: string = 'POST') {
        try {
            const res = await fetch(`https://graph.facebook.com/${this.graphApiVersion}/me/${endpoint}?access_token=${this.accessToken}`, {
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
            entry.messaging.forEach((event: any) => {
                if (event.message && event.message.is_echo && !this.broadcastEchoes) {
                    return
                }
                if (event.message && event.message.text) {
                    if (event.message.quick_reply) {
                        cb('quick_reply', event)
                    } else {
                        cb('message', event)
                    }
                } else if (event.postback) {
                    cb('postback', event)
                } else if (event.read) {
                    cb('read', event)
                } else if (event.delivery) {
                    cb('delivery', event)
                } else if (event.account_linking) {
                    cb('account_linking', event)
                } else if (event.referral) {
                    cb('referral', event)
                } else {
                    console.log('Webhook received unknown event: ', event)
                }
            })
        })
    }

    sendTextMessage(recipientId: object | string, message: any, options: any = {}) {
        if (message.quick_replies && message.quick_replies.length > 0) {
            message.quick_replies = this._formatQuickReplies(message.quick_replies)
        }
        return this.sendMessage(recipientId, message, options)
    }

    async sendMessage(recipientId: object | string, message: any, options: any = {}) {
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
            await this.sendTypingIndicator(recipientId, timeout)
        }
        return this.sendRequest(reqBody)
    }

    sendTypingIndicator(recipientId: object | string, milliseconds: number) {
        const timeout = isNaN(milliseconds) ? 0 : milliseconds
        if (milliseconds > 20000) {
            milliseconds = 20000
            console.error('sendTypingIndicator: max milliseconds value is 20000 (20 seconds)')
        }
        return new Promise(async (resolve, reject) => {
            await this.sendAction(recipientId, 'typing_on')
            setTimeout(() => this.sendAction(recipientId, 'typing_off').then((json) => resolve(json)), timeout)
        })
    }

    sendProfileRequest(body: any, method = 'POST') {
        return this.sendRequest(body, 'messenger_profile', method)
    }

    setGetStartedButton(payload = 'GET_STARTED') {
        return this.sendProfileRequest({
            get_started: {
                payload
            }
        })
    }

    deleteGetStartedButton() {
        return this.sendProfileRequest({
            fields: [
                'get_started'
            ]
        }, 'DELETE')
    }

    setPersistentMenu(buttons: any[], disableInput = false) {
        if (buttons && buttons[0] && buttons[0].locale !== undefined) {
            // Received an array of locales, send it as-is.
            return this.sendProfileRequest({ persistent_menu: buttons })
        }
        // If it's not an array of locales, we'll assume is an array of buttons.
        const formattedButtons = this._formatButtons(buttons)
        return this.sendProfileRequest({
            persistent_menu: [{
                locale: 'default',
                composer_input_disabled: disableInput,
                call_to_actions: formattedButtons
            }]
        })
    }

    deletePersistentMenu() {
        return this.sendProfileRequest({
            fields: [
                'persistent_menu'
            ]
        }, 'DELETE')
    }

    sendAction(recipientId: object | string, action: any) {
        const recipient = this._createRecipient(recipientId)
        return this.sendRequest({
            recipient,
            sender_action: action
        })
    }

    async getUserProfile(userId: string) {
        const url = `https://graph.facebook.com/${this.graphApiVersion}/${userId}?fields=first_name,last_name,gender&access_token=${this.accessToken}`
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