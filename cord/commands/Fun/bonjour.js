const { language, savedb, loadbackup } = require("../../fonctions")
module.exports = {
    name: "bonjour",
    description: "Send a bonjour message",
    run: async (client, message, args, db) => {
      try{
          const emoji = "<a:PikaCoucou:1501176233545961612>"
          message.edit(emoji)
          message.edit(emoji)
          message.edit(emoji)
          message.edit(emoji)
          message.edit(emoji)
          message.edit(emoji)
          }
          catch{}
      }
  }


 