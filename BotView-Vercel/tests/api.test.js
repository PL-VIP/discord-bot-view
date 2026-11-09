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
  assert.equal(endpointFor({action:'guild', guildId,botId:channelId}).batch.length,3);
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
    assert.deepEqual(body.allowed_mentions,{parse:[]});
    return new Response(JSON.stringify({id:guildId,content:body.content}),{status:200});
  };
  try {
    const res = await handleDiscord(request({action:'send',token,channelId,content:' Hello @everyone '}));
    assert.equal(res.status,200);
  } finally { globalThis.fetch = prior; }
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
