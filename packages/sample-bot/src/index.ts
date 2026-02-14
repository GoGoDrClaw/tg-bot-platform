import { Bot } from "grammy";

export default function setup(bot: Bot) {
  bot.command("start", (ctx) => ctx.reply("Sample bot is alive"));
  bot.on("message:text", (ctx) => ctx.reply(`echo: ${ctx.message.text}`));
}
