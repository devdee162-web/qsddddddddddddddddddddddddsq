module.exports = {
    name: "paypal",
    description: "send you add link",
    run: async (client, message, args) => {
      try{
        message.edit(`Mon PayPal : <a:PayPal3:1201577678868860988> 

Lien : https://paypal.me/NitroComptesShop

E-mail : shopcomptesn1tr0@gmail.com

Tag : @NitroComptesShop

Payement : 💸 

en amis proch et sans note !

Screen le payement ! 📳 

Si les conditions ne sont pas respectés = pas de produits.`)
      }
      catch(e){console.log(e)}
    }
  }