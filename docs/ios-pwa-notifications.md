# iOS/PWA notifications

O iPhone nao permite sobreposicao sobre outros apps. Para alertar o motorista fora da tela do app, a versao iOS via Safari precisa usar Web Push.

## Frontend ja preparado

- O PWA registra `/sw.js`.
- O manifesto fica em `/manifest.webmanifest`.
- Quando o motorista fica online no radar, o app pede permissao de notificacao no web.
- Se uma corrida chega enquanto o PWA esta aberto, o app mostra notificacao local.
- Para receber alerta com o PWA em segundo plano, o backend precisa enviar Web Push.

## Variaveis no host do PWA

Se o PWA estiver na Vercel, voce pode configurar a chave publica no host do site.

Na Vercel:

```txt
EXPO_PUBLIC_WEB_PUSH_PUBLIC_KEY=<chave publica VAPID>
EXPO_PUBLIC_WEB_PUSH_ENDPOINT=<endpoint opcional para salvar inscricao>
```

No Azure Static Web Apps, essa variavel e opcional. O PWA tambem consegue buscar a chave publica direto na API:

```txt
GET /api/WebPush/chave-publica
```

Se `EXPO_PUBLIC_WEB_PUSH_ENDPOINT` nao for informado, o app tenta usar:

```txt
https://motoapp-bwadauh0dbcqbubb.centralus-01.azurewebsites.net/api/WebPush/motorista/inscrever
```

## Backend preparado

O backend agora salva a inscricao Web Push do motorista e envia Push quando uma corrida nova e despachada para ele.

Migration criada no backend:

```txt
20260524211546_AdicionarWebPushSubscriptions
```

Ao subir a API no Azure, configure estas variaveis no App Service:

```txt
WebPush__Subject=mailto:suporte@mil-lin.com.br
WebPush__PublicKey=<chave publica VAPID>
WebPush__PrivateKey=<chave privada VAPID>
```

Use a mesma chave publica em `EXPO_PUBLIC_WEB_PUSH_PUBLIC_KEY` na Vercel. A chave privada fica somente no Azure.

Para gerar o par de chaves VAPID:

```txt
npx web-push generate-vapid-keys
```

## Endpoint no backend

`POST /api/WebPush/motorista/inscrever`

Headers:

```txt
Authorization: Bearer <token do motorista>
Content-Type: application/json
```

Body:

```json
{
  "plataforma": "pwa-ios",
  "userAgent": "...",
  "subscription": {
    "endpoint": "...",
    "keys": {
      "p256dh": "...",
      "auth": "..."
    }
  }
}
```

Quando uma corrida nova for lancada para o motorista, o backend envia Web Push para as inscricoes salvas. Payload:

```json
{
  "title": "Nova corrida disponível",
  "body": "Toque para abrir o app do motorista.",
  "url": "/radar",
  "corridaId": 123
}
```
