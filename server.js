import http from 'node:http';
import {readFile} from 'node:fs/promises';
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/questions.js':'questions.js','/style.css':'style.css'};
http.createServer(async(req,res)=>{const name=files[new URL(req.url,'http://localhost').pathname];if(!name){res.writeHead(404);return res.end('Not found');}try{const data=await readFile(new URL(name,import.meta.url));res.writeHead(200,{'Content-Type':name.endsWith('.js')?'text/javascript; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(500);res.end('Unable to load page');}}).listen(4173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:4173'));
