import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const port = 3001;
const ids = { guild:'123456789012345678', bot:'223456789012345678', channel:'323456789012345678', category:'423456789012345678', user:'523456789012345678' };
const allPermissions = String((1n << 53n) - 1n);
const now = Date.now();
const snowflake = offset => String((BigInt(now + offset - 1420070400000) << 22n) + BigInt(Math.max(0,offset + 1000)));
let messages = [
  {id:snowflake(-120000),channel_id:ids.channel,author:{id:ids.user,username:'Kasia',global_name:'Kasia',avatar:null},member:{nick:'Kasia',roles:[]},content:'Czy bot może przygotować raport?',timestamp:new Date(now-120000).toISOString(),edited_timestamp:null,attachments:[],embeds:[],reactions:[{count:2,me:false,emoji:{id:null,name:'👍'}}],pinned:true},
  {id:snowflake(-60000),channel_id:ids.channel,author:{id:ids.bot,username:'BotView',bot:true,avatar:null},member:{nick:'BotView',roles:[]},content:'Tak — raport jest już gotowy.',timestamp:new Date(now-60000).toISOString(),edited_timestamp:null,attachments:[],embeds:[],reactions:[],pinned:false}
];
const guild = {id:ids.guild,name:'BotView Test',owner_id:ids.user,roles:[{id:ids.guild,name:'@everyone',permissions:allPermissions}],features:[]};
const channels = [{id:ids.category,type:4,name:'OGÓLNE',position:0,permission_overwrites:[]},{id:ids.channel,type:0,name:'centrum-dowodzenia',topic:'Test wszystkich funkcji BotView',position:1,parent_id:ids.category,permission_overwrites:[],rate_limit_per_user:0,nsfw:false}];
const member = {user:{id:ids.bot,username:'BotView',bot:true},roles:[]};

const server=createServer(async(req,res)=>{
  const url=new URL(req.url,`http://localhost:${port}`);
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/api/discord'){
    let raw='';for await(const chunk of req)raw+=chunk;
    const body=JSON.parse(raw||'{}');let data;
    if(body.action==='me')data={id:ids.bot,username:'BotView',global_name:'BotView Preview',bot:true,avatar:null};
    else if(body.action==='guilds')data=[{id:ids.guild,name:'BotView Test',icon:null}];
    else if(body.action==='guild')data={guild,channels,member,activeThreads:{threads:[],members:[]}};
    else if(body.action==='messages')data=[...messages].reverse();
    else if(body.action==='pins')data={items:messages.filter(m=>m.pinned).map(message=>({message,pinned_at:new Date().toISOString()})),has_more:false};
    else if(body.action==='send'){data={id:snowflake(1000),channel_id:body.channelId,author:{id:ids.bot,username:'BotView',bot:true},member:{nick:'BotView',roles:[]},content:body.content||'',timestamp:new Date().toISOString(),edited_timestamp:null,attachments:body.file?[{filename:body.file.name,url:'https://example.com/file',content_type:body.file.type}]:[],embeds:body.embed?[body.embed]:[],reactions:[],pinned:false};messages.push(data);}
    else if(body.action==='edit_message'){data={...messages.find(m=>m.id===body.messageId),content:body.content,edited_timestamp:new Date().toISOString()};messages=messages.map(m=>m.id===data.id?data:m);}
    else if(body.action==='create_dm')data={id:'623456789012345678',type:1,recipients:[{id:body.userId,username:'Kasia',global_name:'Kasia'}]};
    else data={id:body.channelId||snowflake(2000),name:body.name||'test',type:body.type??0};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data??null));return;
  }
  const file=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!['index.html','app.js','styles.css','favicon.svg'].includes(file)){res.writeHead(404);res.end();return;}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
  res.writeHead(200,{'Content-Type':types[extname(file)]});res.end(await readFile(join(root,file)));
});
server.listen(port,()=>console.log(`BotView mock preview: http://localhost:${port}`));
