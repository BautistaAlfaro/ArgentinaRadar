# ArgentinaRadar — Refinement Roadmap

> Pipeline: RSS → AI Filter → Telegram Approval → Bluesky Publish  
> Status: MVP funcional | Objetivo: Pulido profesional + features

---

## 🔴 Sprint 1: Pulido de salida (AHORA)

### 1. Image Prompts — NanoBanana 2.0
**Problema**: El prompt en `telegram-notifier.js` es un one-liner genérico.  
**Objetivo**: Usar el template completo de NanoBanana (Python) traducido a prompt plano para Pollinations.

- [x] Mover `build_nanobanana_prompt` a JS o generar prompt rico inline
- [x] Aspect ratio 16:9 (landscape, mejor para Bluesky feeds)
- [x] Incluir source logo visual, texto grande del titular, elementos gráficos
- [x] Sembrar estilo "Only Fonseca + MDZ Online": dramático, alto contraste, azul+oro

### 2. Bluesky Tweet Formatting
**Problema**: Tweet actual es `title.slice(0,250) + source + #ArgentinaRadar` — básico.  
**Objetivo**: Formato profesional con emojis, categorías, hashtags, y smart truncation.

- [x] `🇦🇷 {headline}  | 📰 {source}  | #ArgentinaRadar`
- [x] Categorías con emojis: 🚨Urgente 💰Economía ⚽Deportes 🗳️Política 🌎Sociedad
- [x] Truncar inteligentemente (en punto, no a mitad de palabra)
- [x] Máximo 300 chars (Bluesky) con link opcional

---

## 🟡 Sprint 2: Features de publicación

### 3. Sistema de categorías por tema
- Categorizar noticias argentinas por tema económico, político, social, deportivo, policial
- Badges de color en Telegram + emojis en Bluesky
- Filtro por categoría en `/menu`

### 4. Auto-publish high-impact
- Si AI score > 80 y categoría = "urgente", publicar directo sin aprobación
- Marcar como "auto-published" en DB

### 5. Comando /breaking
- Publicar noticia urgente desde Telegram con texto manual
- Formato: `/breaking [título] | [fuente]`
- Genera imagen + publica en Bluesky al instante

---

## 🟢 Sprint 3: Sistema de notificaciones

### 6. Morning Briefing diario
- Resumen de las 5 noticias más importantes del día
- Enviar a las 8:00 AM a Telegram
- Incluye mini-gráfico de categorías

### 7. Alertas por provincia
- Configurar alertas: "avisame cuando haya noticias de Córdoba"
- `/alert add Córdoba` o `/alert remove`
- Push a Telegram cuando hay matches

### 8. Digest semanal
- Resumen semanal (lunes) con top 10 + estadísticas
- Gráfico de fuentes más activas

---

## 🔵 Sprint 4: UI & UX

### 9. Dashboard mejorado
- Vista de pipeline en tiempo real (RSS → AI → Approval → Published)
- Mapa de calor de noticias por provincia
- Gráficos de actividad por hora/día

### 10. Telegram menu completo
- `/filter política,economía` — filtrar noticias por categoría
- `/search [término]` — buscar en la DB
- `/schedule [hora]` — programar publicación
- `/stats` detallado con gráficos inline

---

## ⚪ Backlog

- Twitter/X integration (cuando haya API key paga)
- Ollama local AI (qwen2.5:7b) para clasificación offline
- Multi-idioma: detectar y traducir noticias en inglés de medios argentinos
- Hashtag automático basado en trending topics argentinos
- Web scraping de fuentes sin RSS (Clarín, La Nación, Infobae sin RSS)
- Analytics dashboard público (sitears.dev/radar)

---

## 📊 Métricas actuales

| Métrica | Valor |
|---------|-------|
| Fuentes RSS activas | 13 |
| Artículos en DB | 637 |
| Publicados en Bluesky | ~5 |
| Pipeline uptime | Manual |
| Tiempo RSS→Bluesky | ~45s |
| Costo mensual | $0 |

---

*Última actualización: 21 Jun 2026*
