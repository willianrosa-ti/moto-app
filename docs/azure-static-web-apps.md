# Azure Static Web Apps

Use este guia para publicar o PWA do motorista no Azure Static Web Apps.

## Criar o recurso

No Azure Portal, crie um recurso `Static Web App`.

Campos recomendados:

```txt
Subscription: a mesma que voce ja usa
Resource Group: o mesmo grupo do MotoApp, se quiser organizar junto
Name: moto-app-motorista
Plan type: Free
Region: a mais proxima disponivel
Deployment source: GitHub
Organization: willianrosa-ti
Repository: moto-app
Branch: developer
```

Build details:

```txt
Build Presets: Custom
App location: /
Api location: deixe em branco
Output location: dist
Build command: npm run build:web
```

Se o portal nao mostrar `Build command`, deixe o Azure criar o workflow e depois confira se o arquivo gerado usa:

```txt
npm run build:web
```

## Variaveis

O Static Web Apps nao precisa guardar a chave privada. Para evitar erro de variavel de build no frontend, o PWA busca a chave publica direto na API por:

```txt
/api/WebPush/chave-publica
```

Entao, no Static Web Apps voce pode deixar sem variaveis.

As variaveis obrigatorias ficam no Azure App Service da API:

```txt
WebPush__PublicKey
WebPush__PrivateKey
WebPush__Subject
```

## Depois do primeiro deploy

O Azure vai gerar uma URL parecida com:

```txt
https://nome-do-app.azurestaticapps.net
```

Abra essa URL no Safari do iPhone, instale na tela inicial e teste o login do motorista.

## API

A API ja foi ajustada para aceitar chamadas vindas de:

```txt
*.azurestaticapps.net
```

Depois de publicar o backend atualizado no App Service, o PWA hospedado no Static Web Apps podera chamar a API normalmente.
