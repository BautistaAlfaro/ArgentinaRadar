# ArgentinaRadar — Refinement Roadmap

> Pipeline: RSS → AI Filter → Telegram Approval → Bluesky Publish  
> Status: MVP funcional | Objetivo: Pulido profesional + features

---

## 🔴 Sprint 1: Pulido de salida ✅ COMPLETADO

### 1. Image Prompts — NanoBanana 2.0 ✅
- Mover `build_nanobanana_prompt` a JS o generar prompt rico inline
- Aspect ratio 16:9 (landscape, mejor para Bluesky feeds)
- Incluir source logo visual, texto grande del titular, elementos gráficos
- Sembrar estilo "Only Fonseca + MDZ Online": dramático, alto contraste, azul+oro

### 2. Bluesky Tweet Formatting ✅
- `🇦🇷 {headline}  | 📰 {source}  | #ArgentinaRadar`
- Categorías con emojis: 🚨Urgente 💰Economía ⚽Deportes 🗳️Política 🌎Sociedad
- Truncar inteligentemente (en punto, no a mitad de palabra)
- Máximo 300 chars (Bluesky) con link opcional

---

## 🟡 Sprint 2: Features de publicación ✅ COMPLETADO

### 3. Sistema de categorías por tema ✅
- Categorizar noticias argentinas por tema económico, político, social, deportivo, policial
- Badges de color en Telegram + emojis en Bluesky
- Filtro por categoría en `/menu`
- 7 categorías: urgente, politica, economia, deportes, policial, sociedad, general
- `shared/categorizer.ts` con keyword matching

### 4. Auto-publish high-impact ✅
- Si AI score > 80 y categoría = "urgente", publicar directo sin aprobación
- Marcar como "auto_published" en DB
- `AUTO_PUBLISH_THRESHOLD=80` en `.env`

### 5. Comando /breaking ✅
- Publicar noticia urgente desde Telegram con texto manual
- Formato: `/breaking [título] | [fuente]`
- Genera imagen + publica en Bluesky al instante

---

## 🟢 Sprint 3: Sistema de notificaciones ✅ COMPLETADO

### 6. Morning Briefing diario ✅
- Resumen de las 5 noticias más importantes del día
- Enviar a las 8:00 AM a Telegram
- Incluye mini-gráfico de categorías
- `/briefing` para on-demand, `scripts/schedule-briefing.ps1` para scheduler

### 7. Alertas por provincia ✅
- Configurar alertas: "avisame cuando haya noticias de Córdoba"
- `/alert add Córdoba` o `/alert remove`
- Push a Telegram cuando hay matches
- Tabla `alerts` en SQLite, matching engine con keywords + provinces

### 8. Digest semanal ✅
- Resumen semanal (lunes) con top 10 + estadísticas
- Gráfico de fuentes más activas
- `scripts/digest.js` con `--dry-run` support

---

## 🔵 Sprint 4: UI & UX ✅ COMPLETADO

### 9. Dashboard mejorado ✅
- Vista de pipeline en tiempo real (RSS → AI → Approval → Published)
- Mapa de calor de noticias por provincia
- Gráficos de actividad por hora/día
- `PipelineView`, `CategoryChart`, `ActivityFeed`, `ServiceCards`

### 10. Telegram menu completo ✅
- `/filter política,economía` — filtrar noticias por categoría
- `/search [término]` — buscar en la DB
- `/schedule [hora]` — programar publicación
- `/stats` detallado con gráficos inline
- `/today` — top 5 últimas 24h
- `/fuentes` — todas las fuentes con conteo
- Paginación en pendientes, botón "Ver fuente"

### 11. RSS Source Manager ✅
- Agregar/quitar/habilitar fuentes desde el admin dashboard
- UI con tabla, toggle on/off, test de URL
- 16 fuentes totales (incluye Minuto Uno, iProfesional, BAE Negocios)
- API REST: `GET/POST/DELETE/PATCH /api/admin/sources`

### 12. Bluesky link cards + hashtags ✅
- Hashtags automáticos basados en keywords del título
- Link cards con URL del artículo original
- Thread format para posts largos
- Alt text en español para imágenes

---

## 🟠 Sprint 5: Inteligencia avanzada ✅ COMPLETADO

### 13. Multi-language detection + auto-translation ✅
- Detector ES/EN/PT con score-counting (150+ indicator words)
- Traducción automática vía Google Translate free (sin API key)
- Endpoint `/api/translate` en ai-processor (puerto 3013)
- Rate limiting: 5 req/s con token bucket
- Columnas: `title_en`, `summary_en`, `translated`, `detected_language`

### 14. Trending topics + news clustering ✅
- `/trending` en Telegram — top 10 temas trending
- Keyword extraction con stop words filtrados
- Clustering con Jaccard similarity + time proximity bonus (< 2h)
- `article_clusters` table en SQLite
- Dashboard tab "Trending" con cards coloreadas por categoría
- Clustering automático cada 30 min

### 15. Quality scoring + AI filter v2 ✅
- Quality scorer heurístico (0-100) con source reputation
- Engagement predictor con category multipliers + time-of-day
- AI filter v2: 6 criterios (political, economic, social, urgency, quality, relevance)
- Auto-discard si quality < `MIN_QUALITY_THRESHOLD` (default 40)
- Dashboard tab "Quality" con métricas + top 10 articles
- Endpoints: `/api/quality/stats`, `/api/quality/thresholds`

---

## ⚪ Backlog

- Twitter/X integration (cuando haya API key paga)
- Ollama local AI (qwen2.5:7b descargando, nomic-embed-text pendiente)
- Web scraping de fuentes sin RSS (Clarín, La Nación, Infobae sin RSS)
- Analytics dashboard público (sitears.dev/radar)

---

## 📊 Métricas actuales

| Métrica | Valor |
|---------|-------|
| Fuentes RSS activas | 16 |
| Artículos en DB | 637 |
| Publicados en Bluesky | ~10 |
| Pipeline uptime | Manual |
| Tiempo RSS→Bluesky | ~45s |
| Costo mensual | $0 |
| Features implementadas | 15 |
| Sub-agentes paralelos | 11 |
| Modelos Ollama | llama3, llama3.2, llama3.2-vision |
| Calidad mínima | 40/100 |

---

*Última actualización: 21 Jun 2026 — Sprint 1-5 completados*
