import { test } from 'node:test';
import assert from 'node:assert/strict';
import { endpointFor, handleDiscord } from '../api/discord.js';

const token = 'aaaabbbbccccdddd.abcdefgh.abcdefghijklmnopqrstuvwxyz';
const guildId = '123456789012345678';
const channelId = '987654321098765432';
function request(body, origin = 'https://example.vercel.app') {
  return new Request('https://example.vercel.app/api/discord', {
    method:'POST', headers:{'Content-Type':'application/json',Origin: origin},
    body:JSON.stringify(body)
  });
}

test('whitelist includes only known routes and valid IDs',()=>{
  assert.deepEqual(endpointFor({action:'me'}),{path:'/users/@me',method:'GET'});
  assert.equal(endpointFor({action:'messages', channelId:'../other'}),null);
  assert.equal(endpointFor({action:'delete',channelId}),null);
  assert.equal(endpointFor({action:'send',channelId,content:'  '}),null);
  assert.equal(endpointFor({action:'send',channelId,content:'x'.repeat(2001)}),null);
  assert.equal(endpointFor({action:'guild', guildId,botId:channelId}).batch.length,4);
  assert.equal(endpointFor({action:'messages',channelId,before:guildId}).path,
    `/channels/${channelId}/messages?limit=50&before=${guildId}`);
});

test('rejects missing token',async()=>{
  const res = await handleDiscord(request({action:'me'}));
  assert.equal(res.status,400);
  assert.equal(res.headers.get('cache-control'),'no-store, private, max-age=0');
});

test('rejects different request origin',async()=>{
  const res = await handleDiscord(request({action:'me',token},'https://other.example'));
  assert.equal(res.status,403);
});

test('does not forward arbitrary endpoint paths', async()=>{
  const res = await handleDiscord(request({action:'proxy',token,path:'https://evil.test'}));
  assert.equal(res.status,400);
});

test('forwards only approved bot API path, never echoes secret',async()=>{
  const prior = globalThis.fetch;
  let invoked = 0;
  globalThis.fetch = async (url, config) => {
    invoked++;
    assert.equal(url,'https://discord.com/api/v10/users/@me');
    assert.equal(config.headers.Authorization,`Bot ${token}`);
    return new Response(JSON.stringify({id:guildId,bot:true,username:'TestBot'}),{
      status:200,headers:{'content-type':'application/json'}
    });
  };
  try {
    const res = await handleDiscord(request({action:'me',token}));
    assert.equal(res.status,200);
    assert.equal(invoked,1);
    const body = await res.text();
    assert.match(body,/TestBot/);
    assert.ok(!body.includes(token));
  } finally { globalThis.fetch = prior; }
});

test('send disallows automatic mentions and respects correct channel path',async()=>{
  const prior = globalThis.fetch;
  globalThis.fetch = async (url,config) => {
    assert.equal(url,`https://discord.com/api/v10/channels/${channelId}/messages`);
    const body = JSON.parse(config.body);
    assert.equal(body.content,'Hello @everyone');
    assert.deepEqual(body.allowed_mentions,{parse:[],replied_user:false});
    return new Response(JSON.stringify({id:guildId,content:body.content}),{status:200});
  };
  try {
    const res = await handleDiscord(request({action:'send',token,channelId,content:' Hello @everyone '}));
    assert.equal(res.status,200);
  } finally { globalThis.fetch = prior; }
});

test('reply, edit and delete message routes are strictly scoped',()=>{
  assert.deepEqual(endpointFor({action:'send',channelId,content:'Odpowiedź',replyTo:guildId}),{
    path:`/channels/${channelId}/messages`,method:'POST',data:{
      content:'Odpowiedź',allowed_mentions:{parse:[],replied_user:false},
      message_reference:{message_id:guildId,fail_if_not_exists:false}
    }
  });
  assert.equal(endpointFor({action:'send',channelId,content:'x',replyTo:'bad'}),null);
  assert.deepEqual(endpointFor({action:'edit_message',channelId,messageId:guildId,content:' Nowa treść '}),{
    path:`/channels/${channelId}/messages/${guildId}`,method:'PATCH',
    data:{content:'Nowa treść',allowed_mentions:{parse:[]}}
  });
  assert.deepEqual(endpointFor({action:'delete_message',channelId,messageId:guildId}),{
    path:`/channels/${channelId}/messages/${guildId}`,method:'DELETE'
  });
});

test('DM and channel management routes validate IDs, names and types',()=>{
  assert.deepEqual(endpointFor({action:'create_dm',userId:guildId}),{
    path:'/users/@me/channels',method:'POST',data:{recipient_id:guildId}
  });
  assert.equal(endpointFor({action:'create_dm',userId:'everyone'}),null);
  assert.deepEqual(endpointFor({action:'create_channel',guildId,name:' pomoc ',type:0,parentId:channelId,topic:' Pytania '}),{
    path:`/guilds/${guildId}/channels`,method:'POST',
    data:{name:'pomoc',type:0,parent_id:channelId,topic:'Pytania'}
  });
  assert.deepEqual(endpointFor({action:'create_channel',guildId,name:'Info',type:4,parentId:channelId}),{
    path:`/guilds/${guildId}/channels`,method:'POST',data:{name:'Info',type:4}
  });
  assert.equal(endpointFor({action:'create_channel',guildId,name:'x',type:2}),null);
  assert.deepEqual(endpointFor({action:'delete_channel',channelId}),{
    path:`/channels/${channelId}`,method:'DELETE'
  });
});

test('reactions, pins and bulk deletion use fixed Discord routes',()=>{
  assert.deepEqual(endpointFor({action:'reaction',channelId,messageId:guildId,emoji:'👍',mode:'add'}),{
    path:`/channels/${channelId}/messages/${guildId}/reactions/${encodeURIComponent('👍')}/@me`,method:'PUT'
  });
  assert.deepEqual(endpointFor({action:'reaction',channelId,messageId:guildId,emoji:'<:wave:123456789012345678>',mode:'remove'}),{
    path:`/channels/${channelId}/messages/${guildId}/reactions/${encodeURIComponent('wave:123456789012345678')}/@me`,method:'DELETE'
  });
  assert.equal(endpointFor({action:'reaction',channelId,messageId:guildId,emoji:'../x',mode:'add'}),null);
  assert.deepEqual(endpointFor({action:'pins',channelId}),{path:`/channels/${channelId}/messages/pins?limit=50`,method:'GET'});
  assert.deepEqual(endpointFor({action:'pin_message',channelId,messageId:guildId,mode:'pin'}),{path:`/channels/${channelId}/messages/pins/${guildId}`,method:'PUT'});
  assert.equal(endpointFor({action:'bulk_delete',channelId,messageIds:[guildId]}),null);
  assert.deepEqual(endpointFor({action:'bulk_delete',channelId,messageIds:[guildId,channelId]}),{path:`/channels/${channelId}/messages/bulk-delete`,method:'POST',data:{messages:[guildId,channelId]}});
});

test('channel editing, threads and moderation validate their payloads',()=>{
  assert.deepEqual(endpointFor({action:'edit_channel',channelId,name:' pomoc ',topic:'FAQ',slowmode:10,nsfw:true,parentId:guildId}),{
    path:`/channels/${channelId}`,method:'PATCH',data:{name:'pomoc',topic:'FAQ',rate_limit_per_user:10,nsfw:true,parent_id:guildId}
  });
  assert.equal(endpointFor({action:'edit_channel',channelId,name:'x',slowmode:99999}),null);
  assert.deepEqual(endpointFor({action:'create_thread',channelId,name:' Temat ',duration:1440}),{
    path:`/channels/${channelId}/threads`,method:'POST',data:{name:'Temat',auto_archive_duration:1440,type:11}
  });
  assert.deepEqual(endpointFor({action:'archive_thread',channelId,locked:true}),{
    path:`/channels/${channelId}`,method:'PATCH',data:{archived:true,locked:true}
  });
  assert.deepEqual(endpointFor({action:'kick_member',guildId,userId:channelId}),{path:`/guilds/${guildId}/members/${channelId}`,method:'DELETE'});
  assert.deepEqual(endpointFor({action:'ban_member',guildId,userId:channelId}),{path:`/guilds/${guildId}/bans/${channelId}`,method:'PUT',data:{delete_message_seconds:0}});
  assert.equal(endpointFor({action:'timeout_member',guildId,userId:channelId,minutes:7}),null);
});

test('message send accepts a bounded embed or attachment and rejects malformed files',()=>{
  const withEmbed=endpointFor({action:'send',channelId,content:'',embed:{title:'Status',description:'OK',color:'#5865f2',url:'https://example.com'}});
  assert.deepEqual(withEmbed.data.embeds,[{title:'Status',description:'OK',url:'https://example.com/',color:0x5865f2}]);
  const withFile=endpointFor({action:'send',channelId,content:'plik',file:{name:'test.txt',type:'text/plain',data:'aGVsbG8='}});
  assert.equal(withFile.file.name,'test.txt');
  assert.equal(endpointFor({action:'send',channelId,content:'',file:{name:'x',type:'text/plain',data:'../'}}),null);
});

test('attachment is forwarded as multipart without overriding its boundary',async()=>{
  const prior=globalThis.fetch;
  globalThis.fetch=async(url,config)=>{
    assert.equal(url,`https://discord.com/api/v10/channels/${channelId}/messages`);
    assert.ok(config.body instanceof FormData);
    assert.equal(config.headers['Content-Type'],undefined);
    assert.equal(JSON.parse(config.body.get('payload_json')).content,'plik');
    const file=config.body.get('files[0]');
    assert.equal(file.name,'hello.txt');
    assert.equal(await file.text(),'hello');
    return new Response(JSON.stringify({id:guildId,content:'plik'}),{status:200});
  };
  try{
    const res=await handleDiscord(request({action:'send',token,channelId,content:'plik',file:{name:'hello.txt',type:'text/plain',data:'aGVsbG8='}}));
    assert.equal(res.status,200);
  }finally{globalThis.fetch=prior;}
});

test('redacts bot token on upstream 401',async()=>{
  const prior = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({message:'Unauthorized'}),{status:401});
  try {
    const res = await handleDiscord(request({action:'me',token}));
    assert.equal(res.status,401);
    assert.ok(!(await res.text()).includes(token));
  } finally { globalThis.fetch = prior; }
});
