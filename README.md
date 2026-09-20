# EXILED Bot

Bot do Discord pra liberar plano premium do app EXILED AI.

## Rotas

- `GET /` — health check
- `POST /comprovante` — recebe comprovante do app

## Variáveis de ambiente

- `DISCORD_TOKEN` — token do bot
- `CHANNEL_ID` — ID do canal Discord
- `FIREBASE_KEY` — JSON do Service Account (string)
