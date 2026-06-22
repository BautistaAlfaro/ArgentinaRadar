# ArgentinaRadar — Próxima Sesión Roadmap

> Estado actual: 18+ features, 1236 artículos, pipeline funcional con Gemini Pro Image

---

## 🔴 FASE 1: Estabilización (1-2h)

### 1.1 React Doctor 58 → 85+
- **44 issues**: 9 bugs, 7 perf, 20 a11y, 8 maint
- Componentes nuevos: ApprovalQueue (518 líneas), Markets (702 líneas), Header (307 líneas)
- Prioridad: bugs primero, después a11y

### 1.2 Pipeline reliability
- Watchdog que realmente funcione (PM2 no instalado)
- Auto-restart real de servicios caídos
- Health check endpoint unificado
- Alertas Telegram si servicio cae

### 1.3 Batch processing control
- Limitar lotes a 5 con flag `batch_size=5`
- Evitar que el processing loop dispare 50+ artículos de golpe
- Rate limiting en generación de imágenes

---

## 🟡 FASE 2: Calidad de imagen (1-2h)

### 2.1 Prompt engineering Gemini
- Testear variaciones del prompt para mejor resultado
- A/B testing: Pollinations vs Gemini
- Prompt templates por categoría (economía, política, deportes)
- System prompt optimizado para NanoBanana Pro

### 2.2 Image pipeline robusto
- Reintento si Gemini falla → fallback a Pollinations
- Cache de imágenes generadas (no regenerar si ya existe)
- Validación de tamaño/dimensiones antes de publicar

### 2.3 Formato de imagen
- 1080x1350 vertical (optimizado para mobile)
- Alternativa: 1200x630 horizontal (mejor para Twitter/web)
- Watermark "ArgentinaRadar" sutil

---

## 🟢 FASE 3: UX & Dashboard (2-3h)

### 3.1 ControlCenter 2.0
- Unificar tabs: Panel de Control como ÚNICA vista
- Service status en tiempo real sin polling excesivo
- Gráficos con datos REALES (no mock)
- Quick actions funcionales (refresh RSS, reprocess, backup)

### 3.2 Approval Queue en dashboard
- Aprobar/rechazar desde el dashboard (no solo Telegram)
- Vista previa de imagen antes de publicar
- Batch approve con confirmación

### 3.3 Telegram /panel mejoras
- Stats en tiempo real (artículos/hora, publicados hoy)
- Gráfico mini de actividad
- Toggle servicios funcional (sin duplicar procesos)

---

## 🔵 FASE 4: Automatización (2-3h)

### 4.1 Pipeline nocturno
- Procesar TODOS los artículos pendientes de 00:00 a 06:00
- Auto-publicar los de alta calidad (>80) sin aprobación
- Reporte matutino de lo publicado

### 4.2 Content curation
- Detección de noticias duplicadas (mismo tema, diferentes fuentes)
- Agrupación por evento
- Priorización: noticias nacionales > provinciales > internacionales

### 4.3 Social media optimization
- Mejor horario para publicar (análisis de engagement)
- Hashtags automáticos basados en trending
- Thread format para noticias largas (>300 chars)

---

## 🟣 FASE 5: Infraestructura (1-2h)

### 5.1 PM2 real
- Instalar PM2 global: `npm i -g pm2`
- `ecosystem.config.cjs` ya existe — solo falta PM2
- `pm2 start ecosystem.config.cjs`
- `pm2 save` para auto-start en reboot

### 5.2 Deploy checklist
- Variables de entorno seguras (.env nunca en git)
- Health checks para todos los servicios
- Logs rotation configurado
- Backup automático funcional

### 5.3 GitHub Actions
- CI: TypeScript check + react-doctor en cada push
- Nightly: procesar batch de artículos
- No exponer secrets en Actions

---

## ⚪ Icebox

- Web scraping Puppeteer para fuentes sin RSS
- Analytics dashboard público (sitears.dev/radar)
- Twitter/X integration (API paga)
- Multi-idioma real (traducción automática de títulos)
- Email digests (SendGrid free tier)
- Mobile PWA

---

## 📊 Estado al cierre de sesión

| Métrica | Valor |
|----------|-------|
| Artículos DB | 1,236 |
| Approval queue | 15 |
| Gemini imágenes generadas | ~5 |
| Costo OpenRouter | ~$0.01 |
| Servicios core | 5/12 running |
| React Doctor | 58/100 |
| Commits sesión | 14 |
| Features nuevas | 5 (OpenRouter, Gemini, MDZ prompt, image guard, batch-5) |

---

*Próxima sesión: empezar por FASE 1 (estabilización + react-doctor)*
