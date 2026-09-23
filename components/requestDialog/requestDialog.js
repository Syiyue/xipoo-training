Component({
  properties: {
    visible: {
      type: Boolean,
      value: false
    },
    targetUser: {
      type: Object,
      value: {}
    },
    lang: {
      type: String,
      value: 'zh'
    }
  },

  data: {
    message: ''
  },

  observers: {
    'visible'(val) {
      if (val) {
        this.setData({ message: '' })
      }
    }
  },

  methods: {
    onMessageInput(e) {
      this.setData({ message: e.detail.value })
    },

    onClose() {
      this.triggerEvent('close')
    },

    onSend() {
      const { targetUser, message } = this.data
      this.triggerEvent('send', {
        targetId: targetUser.id,
        message: message.trim()
      })
    },

    noop() {}
  }
})