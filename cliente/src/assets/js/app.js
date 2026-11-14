/* ==========================================================
   Cliente de la plataforma (compartido por todos los países y cursos).
   Habla con el servidor según servidor/CONTRATO-API.md.
   Configuración: window.CONFIG (la inyecta build.js).
   ========================================================== */
(function () {
  "use strict";

  var CFG = window.CONFIG;
  var CLAVE_SESION = "mc_sesion_v4";
  var HITOS = [25, 50, 75, 100];
  var FRASES = [
    "🎉 ¡Excelente! Una clase más dominada. Sigue así.",
    "💪 ¡Gran avance! Cada clase te acerca a dominar las reparaciones.",
    "⚡ ¡Clase completada! Tu constancia marca la diferencia.",
    "🛠️ ¡Muy bien hecho! Paso a paso te conviertes en experto."
  ];

  var sesion = null;        // { token, email, whatsapp, nombre }
  var publico = null;       // { clases:[{orden,modulo,titulo,gratis,url}], materiales:[{titulo}] }
  var estado = null;        // respuesta de "estado" (solo con inscripción)
  var claseActual = null;   // título de la clase en reproducción
  var filtro = "";
  var urlsPago = {};        // cache de enlaces de clases de pago (solo en memoria)
  var primeraVez = true;    // autoplay de la primera clase

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Utilidades ---------- */

  // Valida email
  function validarEmail(raw) {
    var e = String(raw || "").trim().toLowerCase();
    // RFC 5322 simplificado
    var re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(e) ? e : null;
  }

  /* ---------- Enhanced Ecommerce Data Layer Helpers ---------- */

  // Envía evento de ecommerce a dataLayer (para GA4 Enhanced Ecommerce)
  function trackEcommerce(eventName, ecommerceData) {
    try {
      var data = Object.assign({ event: eventName, ecommerce: ecommerceData }, {
        curso_id: CFG.course_id,
        pais: CFG.country,
        vendedor: CFG.seller
      });
      if (typeof window.gtag === "function") window.gtag("event", eventName, data);
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(data);
    } catch (e) { /* silencioso */ }
  }

  // Item de producto (curso) para ecommerce
  function getCourseItem() {
    return {
      item_id: CFG.course_id,
      item_name: CFG.courseName,
      price: parseFloat(String(CFG.price).replace(/[^\d.]/g, "")) || 0,
      currency: CFG.country === "pe" ? "PEN" : "USD",
      item_category: "online_course",
      item_category2: "mobile_repair",
      item_brand: CFG.brand,
      item_variant: CFG.country.toUpperCase()
    };
  }

  function mensajeEn(id, texto, tipo) {
    var el = $(id);
    if (!el) return;
    el.textContent = texto || "";
    el.className = "formulario-estado" + (tipo === "error" ? " formulario-estado--error" : "");
  }

  function toast(texto) {
    var el = $("toast-motivacion");
    if (!el) return;
    el.textContent = texto;
    el.classList.remove("oculto");
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.classList.add("oculto"); }, 4000);
  }

  function mostrar(id, si) {
    var el = $(id);
    if (el) el.classList.toggle("oculto", !si);
  }

  function ocultarSegunModo() {
    var alumno = !!estado;
    document.querySelectorAll("[data-solo]").forEach(function (el) {
      var modo = el.getAttribute("data-solo");
      el.classList.toggle("oculto", modo === "alumno" ? !alumno : alumno);
    });
  }

  /* ---------- GA4 / GTM Event Tracking ---------- */

  // Envía evento a dataLayer (GA4 + GTM)
  function trackEvent(eventName, params) {
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", eventName, Object.assign({}, params, {
          curso_id: CFG.course_id,
          pais: CFG.country,
          vendedor: CFG.seller
        }));
      }
      // También empujamos a dataLayer directamente para GTM
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: eventName }, params, {
        curso_id: CFG.course_id,
        pais: CFG.country,
        vendedor: CFG.seller
      }));
    } catch (e) { /* silencioso */ }
  }

  function guardarSesion(s) { sesion = s; localStorage.setItem(CLAVE_SESION, JSON.stringify(s)); }
  function leerSesion() {
    try { return JSON.parse(localStorage.getItem(CLAVE_SESION)) || null; } catch (e) { return null; }
  }
  function borrarSesion() {
    sesion = null; estado = null; urlsPago = {};
    localStorage.removeItem(CLAVE_SESION);
  }

  function urlConAutoplay(url, activar) {
    if (!activar) return url;
    var yt = /youtube\.com\/embed|youtube-nocookie\.com\/embed/.test(url);
    var vimeo = /player\.vimeo\.com/.test(url);
    if (!yt && !vimeo) return url;
    return url + (url.indexOf("?") === -1 ? "?" : "&") + "autoplay=1" + (CFG.autoplaySilenciado ? "&mute=1" : "");
  }

  function origen() {
    var p = new URLSearchParams(location.search);
    return (p.get("utm_campaign") || p.get("ref") || "directo").slice(0, 40);
  }

  /* ---------- Scroll Depth Tracking ---------- */

  var scrollDepthTracked = { 25: false, 50: false, 75: false, 100: false };
  function initScrollTracking() {
    var maxScroll = 0;
    window.addEventListener("scroll", function () {
      var scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      var docHeight = document.documentElement.scrollHeight - window.innerHeight;
      var scrollPct = docHeight > 0 ? Math.round((scrollTop / docHeight) * 100) : 0;
      if (scrollPct > maxScroll) maxScroll = scrollPct;
      [25, 50, 75, 100].forEach(function (threshold) {
        if (maxScroll >= threshold && !scrollDepthTracked[threshold]) {
          scrollDepthTracked[threshold] = true;
          trackEvent("scroll_depth", { depth: threshold, max_scroll: maxScroll });
        }
      });
    }, { passive: true });
  }

  /* ---------- Video Progress Tracking (YouTube iframe postMessage) ---------- */

  var videoProgressTracked = {};
  function initVideoProgressTracking() {
    window.addEventListener("message", function (e) {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.event !== "onStateChange" && e.data.info !== "progress") return;
      var iframe = document.getElementById("iframe-reproductor");
      if (!iframe || e.source !== iframe.contentWindow) return;

      if (e.data.info === "progress" && e.data.data) {
        var progress = Math.round(e.data.data.playbackProgress * 100);
        var key = claseActual + "_" + progress;
        if (!videoProgressTracked[key]) {
          videoProgressTracked[key] = true;
          trackEvent("video_progress", {
            lesson_name: claseActual,
            course_id: CFG.course_id,
            progress_percent: progress,
            video_duration: e.data.data.duration || 0
          });
        }
      }
    });
  }

  /* ---------- Session Tracking ---------- */

  var sessionStartTime = Date.now();
  var sessionTracked = false;
  function initSessionTracking() {
    if (sessionTracked) return;
    sessionTracked = true;
    trackEvent("session_start", {
      session_id: "sess_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9),
      referrer: document.referrer || "direct",
      landing_page: location.pathname + location.search,
      user_agent: navigator.userAgent
    });

    // Track session end on beforeunload
    window.addEventListener("beforeunload", function () {
      var durationSec = Math.round((Date.now() - sessionStartTime) / 1000);
      trackEvent("session_end", { session_duration_seconds: durationSec });
    });
  }

  /* ---------- Search Tracking ---------- */

  var searchDebounce = null;
  function trackSearch(query) {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(function () {
      if (query && query.length >= 2) {
        trackEvent("search", {
          search_term: query,
          results_count: items().filter(function (c) {
            return c.title.toLowerCase().indexOf(query.toLowerCase()) !== -1 ||
                   c.module.toLowerCase().indexOf(query.toLowerCase()) !== -1;
          }).length
        });
      }
    }, 300);
  }

  /* ---------- Badge/Medal Tracking ---------- */

  function trackBadgeEarned(hito) {
    trackEvent("badge_earned", {
      badge_name: "medalla_" + hito + "_pct",
      badge_level: hito,
      course_id: CFG.course_id,
      user_id: sesion ? sesion.email : null,
      total_lessons: items().length,
      completed_lessons: estado ? estado.watched_lesson_ids.length : 0
    });

    // Enhanced Ecommerce: milestone reached
    trackEcommerce("milestone_reached", {
      milestone_id: "medalla_" + hito,
      milestone_name: hito + "% del curso completado",
      course_id: CFG.course_id
    });
  }

  /* ---------- Note Tracking ---------- */

  function trackNoteCreated(clase, hasTimestamp) {
    trackEvent("note_created", {
      lesson_name: clase,
      course_id: CFG.course_id,
      user_id: sesion ? sesion.email : null,
      has_timestamp: hasTimestamp
    });
  }

  function trackNoteDeleted(notaId) {
    trackEvent("note_deleted", {
      note_id: notaId,
      course_id: CFG.course_id,
      user_id: sesion ? sesion.email : null,
    });
  }

  /* ---------- Material View Item (Enhanced Ecommerce) ---------- */

  function trackViewItem(materialName) {
    var item = getCourseItem();
    item.item_id = "material_" + materialName.replace(/\s+/g, "_").toLowerCase();
    item.item_name = materialName;
    item.item_category = "course_material";
    item.price = 0;

    trackEcommerce("view_item", {
      items: [item]
    });
  }

  /* ---------- Drive Folder Enhanced Ecommerce ---------- */

  function trackDriveFolderAccess(action, extra) {
    var item = getCourseItem();
    item.item_id = "drive_folder_" + CFG.course_id;
    item.item_name = "Carpeta completa en Google Drive - " + CFG.courseName;
    item.item_category = "drive_access";
    item.price = 0;

    trackEcommerce(action, Object.assign({
      items: [item]
    }, extra));
  }

  /* ---------- Form Error Tracking ---------- */

  function trackFormError(formName, fieldName, errorType) {
    trackEvent("form_error", {
      form_name: formName,
      field_name: fieldName,
      error_type: errorType,
      course_id: CFG.course_id
    });
  }

  /* ---------- Video Play/Pause/Complete ---------- */

  function initVideoPlayTracking() {
    // Escuchar eventos del reproductor YouTube vía postMessage
    window.addEventListener("message", function (e) {
      if (!e.data || e.source !== document.getElementById("iframe-reproductor")?.contentWindow) return;

      if (e.data.event === "onStateChange") {
        var state = e.data.info;
        if (state === 1) { // playing
          trackEvent("video_play", { lesson_name: claseActual, course_id: CFG.course_id });
        } else if (state === 2) { // paused
          trackEvent("video_pause", { lesson_name: claseActual, course_id: CFG.course_id });
        } else if (state === 0) { // ended
          trackEvent("video_complete", { lesson_name: claseActual, course_id: CFG.course_id });
        }
      }
    });
  }

  /* ---------- Comunicación con el servidor ---------- */

  // Nueva API v4: usa CFG.apiBase con Authorization Bearer
  function apiCall(path, options) {
    options = options || {};
    var headers = { "Content-Type": "application/json" };
    if (sesion && sesion.token) {
      headers["Authorization"] = "Bearer " + sesion.token;
    }
    return fetch(CFG.apiBase + path, {
      method: options.method || "GET",
      headers: headers,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(function (r) {
      // Manejar respuestas 204 No Content
      if (r.status === 204) {
        return { ok: true };
      }
      // Manejar respuestas no exitosas (4xx, 5xx)
      if (!r.ok) {
        return r.json().catch(function () {
          return { ok: false, codigo: "HTTP_" + r.status, mensaje: "Error del servidor (" + r.status + ")" };
        }).then(function (err) {
          return { ok: false, codigo: err.codigo || "HTTP_" + r.status, mensaje: err.mensaje || "Error del servidor (" + r.status + ")" };
        });
      }
      // Intentar parsear JSON
      return r.json().catch(function () {
        return { ok: false, codigo: "PARSE_ERROR", mensaje: "Respuesta inválida del servidor." };
      });
    }).catch(function () {
      return { ok: false, codigo: "RED", mensaje: "Sin conexión. Revisa tu internet e intenta de nuevo." };
    });
  }

  // Mapea acciones v3 → endpoints v4 (para compatibilidad durante migración)
  function pedir(accion, extra) {
    var map = {
      estado: { method: "GET", path: "/api/me?course_id=" + CFG.course_id },
      activar: { method: "POST", path: "/api/auth/activate", body: { course_id: CFG.course_id, code: extra.codigo } },
      progreso: { method: "POST", path: "/api/progress", body: { course_id: CFG.course_id, lesson_id: extra.lesson_id, watched: extra.visto } },
      obtener_clase: { method: "GET", path: "/api/lessons/" + extra.lesson_id },
      obtener_material: { method: "GET", path: "/api/materials/" + extra.material_id },
      nota_guardar: { method: "POST", path: "/api/notes", body: { course_id: CFG.course_id, lesson_id: extra.lesson_id, timestamp: extra.minuto, content: extra.texto } },
      nota_eliminar: { method: "DELETE", path: "/api/notes/" + extra.id },
      medalla: { method: "POST", path: "/api/badges", body: { course_id: CFG.course_id, milestone: extra.hito } },
      logout: { method: "POST", path: "/api/auth/logout" },
      cambiar_password: { method: "POST", path: "/api/auth/password/change", body: { current: extra.actual, new: extra.nueva } },
    };
    var cfg = map[accion];
    if (!cfg) return Promise.reject({ ok: false, codigo: "ACCION_INVALIDA", mensaje: "Acción no mapeada" });
    return apiCall(cfg.path, { method: cfg.method, body: cfg.body }).then(function (r) {
      if (r && r.codigo === "SESION_INVALIDA") {
        borrarSesion();
        ocultarSegunModo();
        mostrar("bloque-registro", true);
        mensajeEn("estado-entrar", "Tu sesión venció. Entra de nuevo.", "error");
        location.hash = "#acceso";
      } else if (r && r.codigo === "CAMBIO_REQUERIDO") {
        mostrarCambio();
      }
      return r;
    });
  }

  /* ---------- Temario y clases ---------- */

  // Lista unificada: para visitantes, la pública; para alumnos, el estado.
  // Usa lesson_id (numérico) en lugar de título
  function items() {
    if (estado) {
      return estado.lessons.map(function (c) {
        return { lesson_id: c.lesson_id, module: c.module, title: c.title, sort_order: c.sort_order, is_free: c.is_free, available: c.available, url: c.url };
      });
    }
    if (publico) {
      return publico.clases.map(function (c) {
        return { lesson_id: c.lesson_id || c.orden, module: c.module, title: c.title || c.titulo, sort_order: c.sort_order || c.orden, is_free: c.is_free || c.gratis, available: c.available || c.gratis, url: c.url };
      });
    }
    return [];
  }
  function itemDe(lessonId) {
    return items().filter(function (c) { return c.lesson_id === lessonId; })[0] || null;
  }
  function vista(lessonId) { return !!estado && estado.watched_lesson_ids && estado.watched_lesson_ids.indexOf(lessonId) !== -1; }
  function completo() { return !!estado && estado.access === "FULL"; }

  function renderTemario() {
    var cont = $("lista-temario");
    cont.innerHTML = "";
    var lista = items();
    var modulo = null, det = null;
    var q = filtro.toLowerCase();

    lista.forEach(function (c) {
      if (q && c.title.toLowerCase().indexOf(q) === -1 && c.module.toLowerCase().indexOf(q) === -1) return;
      if (c.module !== modulo) {
        modulo = c.module;
        det = document.createElement("details");
        det.className = "acordeon";
        det.open = true;
        var sum = document.createElement("summary");
        sum.textContent = modulo;
        det.appendChild(sum);
        cont.appendChild(det);
      }
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "item-clase" + (c.lesson_id === claseActual ? " item-clase--activa" : "");
      var icono = document.createElement("span");
      icono.className = "item-clase__icono";
      icono.setAttribute("aria-hidden", "true");
      icono.textContent = vista(c.lesson_id) ? "✅" : (c.available ? "▶️" : "🔒");
      var nombre = document.createElement("span");
      nombre.className = "item-clase__nombre";
      nombre.textContent = c.title;
      var tag = document.createElement("span");
      tag.className = "item-clase__tag";
      if (c.is_free && !completo()) tag.textContent = "GRATIS";
      btn.appendChild(icono);
      btn.appendChild(nombre);
      btn.appendChild(tag);
      (function (lessonId) { btn.addEventListener("click", function () { reproducir(lessonId, false); }); })(c.lesson_id);
      det.appendChild(btn);
    });

    var total = lista.length;
    var vistas = lista.filter(function (c) { return vista(c.lesson_id); }).length;
    var pct = total ? Math.round((vistas / total) * 100) : 0;
    $("texto-porcentaje").textContent = pct + "% (" + vistas + "/" + total + ")";
    $("barra-relleno").style.width = pct + "%";
    if (estado) HITOS.forEach(function (h) { var el = $("medalla-" + h); if (el) el.classList.toggle("medalla--activa", estado.badges && estado.badges.indexOf(h) !== -1); });
  }

  // Enlace de una clase: gratis desde la lista; de pago desde el servidor (con cache).
  function enlaceDe(lessonId) {
    var c = itemDe(lessonId);
    if (!c) return Promise.resolve({ ok: false, mensaje: "Clase no encontrada." });
    if (c.is_free && c.url) return Promise.resolve({ ok: true, url: c.url });
    if (urlsPago[lessonId]) return Promise.resolve({ ok: true, url: urlsPago[lessonId] });
    return pedir("obtener_clase", { lesson_id: lessonId }).then(function (r) {
      if (r.ok) urlsPago[lessonId] = r.url;
      return r;
    });
  }

  function reproducir(lessonId, auto) {
    claseActual = lessonId;
    var c = itemDe(lessonId);
    if (!c) return;
    $("etiqueta-modulo-actual").textContent = c.module;
    $("titulo-clase-actual").textContent = c.title;
    $("aviso-vacio").classList.add("oculto");

    if (!c.available) {
      $("iframe-reproductor").src = "about:blank";
      mostrar("capa-bloqueo", true);
      $("etiqueta-estado-clase").textContent = "🔒 Clase de pago";
      $("etiqueta-estado-clase").className = "reproductor-barra__estado reproductor-barra__estado--bloqueado";
    } else {
      mostrar("capa-bloqueo", false);
      var etiqueta = c.is_free && !completo() ? "🔓 CLASE GRATUITA" : "✅ ACCESO VITALICIO ACTIVO";
      $("etiqueta-estado-clase").textContent = etiqueta;
      $("etiqueta-estado-clase").className = "reproductor-barra__estado";
      var activar = auto && primeraVez && CFG.autoplayPrimeraClase;
      enlaceDe(lessonId).then(function (r) {
        if (claseActual !== lessonId) return;          // el alumno ya cambió de clase
        if (!r.ok) return mensajeEn("estado-nota", r.mensaje, "error");
        $("iframe-reproductor").src = urlConAutoplay(r.url, activar);

        // GA4: lesson_start (solo si está disponible y se reproduce)
        if (!auto || primeraVez) {
          trackEvent("lesson_start", {
            lesson_name: c.title,
            lesson_module: c.module,
            lesson_order: c.sort_order,
            course_id: CFG.course_id,
            access_type: c.is_free && !completo() ? "free" : "full"
          });
        }
      });
    }
    if (auto) primeraVez = false;

    $("btn-marcar-vista").textContent = vista(lessonId) ? "✅ Clase completada" : "⬜ Marcar como vista";
    renderNotas();
    renderTemario();
    renderMateriales();
  }

  function indiceActual() {
    var lista = items();
    for (var i = 0; i < lista.length; i++) if (lista[i].lesson_id === claseActual) return i;
    return -1;
  }
  function moverClase(delta) {
    var lista = items();
    var i = indiceActual();
    var n = i + delta;
    if (n >= 0 && n < lista.length) reproducir(lista[n].lesson_id, false);
  }
  function siguienteSinVer() {
    var lista = items();
    for (var i = 0; i < lista.length; i++) if (lista[i].available && !vista(lista[i].lesson_id)) return lista[i].lesson_id;
    return lista.length ? lista[0].lesson_id : null;
  }

  /* ---------- Progreso, medallas y apuntes (alumnos) ---------- */

  function alternarVista() {
    if (!estado || !claseActual) return;
    var marcar = !vista(claseActual);
    pedir("progreso", { course_id: CFG.course_id, lesson_id: claseActual, watched: marcar }).then(function (r) {
      if (!r.ok) return mensajeEn("estado-nota", r.mensaje, "error");
      estado.watched_lesson_ids = r.watched_lesson_ids;
      if (marcar) {
        toast(FRASES[estado.watched_lesson_ids.length % FRASES.length]);
        // GA4: lesson_complete
        trackEvent("lesson_complete", {
          lesson_name: itemDe(claseActual)?.title || claseActual,
          course_id: CFG.course_id,
          user_id: sesion.email,
          progress_percent: Math.round((estado.watched_lesson_ids.length / items().length) * 100)
        });
      } else {
        // GA4: lesson_unmark (opcional)
        trackEvent("lesson_unmark", { lesson_name: itemDe(claseActual)?.title || claseActual, course_id: CFG.course_id });
      }
      reproducir(claseActual, false);
      comprobarMedallas();
    });
  }

  function comprobarMedallas() {
    var total = items().length;
    var pct = total ? Math.floor((estado.watched_lesson_ids.length / total) * 100) : 0;
    HITOS.forEach(function (h) {
      if (pct < h || (estado.badges && estado.badges.indexOf(h) !== -1)) return;
      pedir("medalla", { course_id: CFG.course_id, milestone: h }).then(function (r) {
        if (!r.ok || (estado.badges && estado.badges.indexOf(h) !== -1)) return;
        if (!estado.badges) estado.badges = [];
        estado.badges.push(h);
        toast("🏆 ¡Desbloqueaste la medalla del " + h + "% del curso!");
        renderTemario();
        // GA4: badge_earned + Enhanced Ecommerce milestone
        trackBadgeEarned(h);
      });
    });
  }

  function renderNotas() {
    var lista = $("lista-notas-clase");
    lista.innerHTML = "";
    if (!estado) return;
    var propias = estado.notes.filter(function (n) { return n.lesson_id === claseActual; });
    if (!propias.length) {
      var vacio = document.createElement("li");
      vacio.className = "lista-notas__vacia";
      vacio.textContent = "Aún no tienes apuntes en esta clase.";
      lista.appendChild(vacio);
      return;
    }
    propias.forEach(function (n) {
      var li = document.createElement("li");
      li.className = "nota";
      var cab = document.createElement("div");
      cab.className = "nota__cabecera";
      var min = document.createElement("strong");
      min.textContent = n.timestamp_text ? "⏱ " + n.timestamp_text : "Apunte";
      var borrar = document.createElement("button");
      borrar.type = "button";
      borrar.className = "boton boton--enlace";
      borrar.textContent = "Eliminar";
      borrar.addEventListener("click", function () { borrarNota(n.id); });
      cab.appendChild(min);
      cab.appendChild(borrar);
      var texto = document.createElement("p");
      texto.textContent = n.content;
      li.appendChild(cab);
      li.appendChild(texto);
      lista.appendChild(li);
    });
  }

  function guardarNota() {
    if (!estado) return mensajeEn("estado-nota", "Entra a tu cuenta para guardar apuntes.", "error");
    var texto = $("input-nueva-nota").value.trim();
    if (!claseActual) return mensajeEn("estado-nota", "Selecciona una clase primero.", "error");
    if (!texto) return mensajeEn("estado-nota", "Escribe un apunte antes de guardar.", "error");
    var tieneTiempo = !!$("input-nota-tiempo").value.trim();
    pedir("nota_guardar", { course_id: CFG.course_id, lesson_id: claseActual,
                             timestamp: $("input-nota-tiempo").value.trim(), content: texto }).then(function (r) {
      if (!r.ok) return mensajeEn("estado-nota", r.mensaje, "error");
      estado.notes.push(r.nota);
      $("input-nueva-nota").value = "";
      $("input-nota-tiempo").value = "";
      mensajeEn("estado-nota", "Apunte guardado.");
      // GA4: note_created
      trackNoteCreated(itemDe(claseActual)?.title || claseActual, tieneTiempo);
      renderNotas();
    });
  }

  function borrarNota(id) {
    pedir("nota_eliminar", { id: id }).then(function (r) {
      if (!r.ok) return mensajeEn("estado-nota", r.mensaje, "error");
      estado.notes = estado.notes.filter(function (n) { return n.id !== id; });
      // GA4: note_deleted
      trackNoteDeleted(id);
      renderNotas();
    });
  }

  /* ---------- Materiales ---------- */

  function renderMateriales() {
    var cont = $("contenedor-pdfs");
    cont.innerHTML = "";

    if (estado && completo() && estado.drive_folder_url) {
      var caja = document.createElement("div");
      caja.className = "carpeta-box";
      var t = document.createElement("h4");
      t.textContent = "Tu carpeta completa del curso";
      var p = document.createElement("p");
      p.textContent = "Ábrela en Google Drive y descarga lo que quieras, en tu computadora o tu celular. Es tuya aunque luego no uses la plataforma.";
      var a = document.createElement("a");
      a.className = "boton boton--principal";
      a.href = estado.drive_folder_url;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = "Abrir mi carpeta en Google Drive";
      // Track view_item for drive folder
      a.addEventListener("click", function () {
        trackViewItem("Carpeta completa Google Drive");
        trackDriveFolderAccess("view_item", { action: "view_drive_folder_link" });
      });
      caja.appendChild(t); caja.appendChild(p); caja.appendChild(a);
      cont.appendChild(caja);
    }

    var lista = estado && completo() ? estado.materials : (publico ? publico.materiales.map(function (m) { return { titulo: m.title || m.titulo, descargado: false }; }) : []);
    lista.forEach(function (m) {
      var fila = document.createElement("div");
      fila.className = "material";
      var nombre = document.createElement("span");
      nombre.className = "material__nombre";
      nombre.textContent = m.titulo;
      var boton = document.createElement("button");
      boton.type = "button";
      boton.className = "boton boton--secundario boton--pequeno";
      if (estado && completo()) {
        boton.textContent = m.descargado ? "✓ Descargado · Abrir de nuevo" : "📥 Descargar";
        boton.addEventListener("click", function () {
          // GA4: view_item for material
          trackViewItem(m.titulo);
          descargar(m.titulo);
        });
      } else {
        boton.textContent = "🔒 Incluido en el curso completo";
        boton.addEventListener("click", function () { location.hash = "#oferta"; });
      }
      fila.appendChild(nombre);
      fila.appendChild(boton);
      cont.appendChild(fila);
    });
  }

  function descargar(titulo) {
    // GA4: material_download
    trackEvent("material_download", {
      material_name: titulo,
      course_id: CFG.course_id,
      user_id: sesion ? sesion.email : null
    });

    pedir("obtener_material", { course_id: CFG.course_id, material_id: titulo }).then(function (r) {
      if (!r.ok) return toast(r.mensaje || "No se pudo abrir el material.");
      if (estado && completo()) {
        estado.materials.forEach(function (m) { if (m.titulo === titulo) m.descargado = true; });
      }
      window.open(r.url, "_blank", "noopener");
      renderMateriales();
    });
  }

  /* ---------- Pantallas y carga de estado ---------- */

  function mostrarAcceso() {
    mostrar("bloque-registro", true);
    mostrar("bloque-cambiar", false);
    ocultarSegunModo();
  }
  function mostrarCambio() {
    mostrar("bloque-registro", false);
    mostrar("bloque-cambiar", true);
    location.hash = "#acceso";
  }

  function cargarPublico() {
    return apiCall("/api/courses/" + CFG.course_id + "/public").then(function (r) {
      if (r.ok) publico = r;
      renderTemario();
      renderMateriales();
    });
  }

  function cargarEstado() {
    return pedir("estado").then(function (r) {
      if (!r.ok) {
        if (r.codigo === "NO_INSCRITO") return false;
        return false;
      }
      estado = r;
      return true;
    });
  }

  // Entra como alumno: carga el estado y abre la primera clase disponible.
  function entrarAlCurso(mensaje) {
    return cargarEstado().then(function (ok) {
      ocultarSegunModo();
      if (!ok) {
        if (mensaje) mensajeEn("estado-entrar", "No estás inscrito en este curso todavía.", "error");
        return false;
      }
      mostrar("bloque-registro", false);
      $("saludo").textContent = "Hola, " + sesion.nombre;
      $("saludo-panel").textContent = "¡Hola, " + sesion.nombre + "! Qué bueno verte en clase";
      renderTemario();
      reproducir(siguienteSinVer(), true);
      if (mensaje) mensajeEn("estado-entrar", mensaje);
      actualizarPanelDrive();
      return true;
    });
  }

  /* ---------- Acceso a carpeta Drive (alumnos con acceso FULL) ---------- */

  function obtenerCarpetaDrive() {
    var btn = $("btn-obtener-drive");
    var estadoEl = $("estado-drive");
    if (!btn || !estadoEl) return;

    // GA4: drive_folder_access_click
    trackEvent("drive_folder_access_click", {
      course_id: CFG.course_id,
      user_id: sesion ? sesion.email : null,
    });

    // Enhanced Ecommerce: begin_checkout for drive folder access
    trackDriveFolderAccess("begin_checkout", { action: "request_drive_folder" });

    btn.disabled = true;
    btn.textContent = "Obteniendo enlace…";
    estadoEl.textContent = "";
    estadoEl.className = "drive-acceso__estado";

    // Llamada directa al Workers API (no al Apps Script)
    var apiBase = "https://mastercelular-api.sectorx047.workers.dev";
    var token = sesion ? sesion.token : "";
    if (!token) {
      estadoEl.textContent = "Tu sesión ha expirado. Vuelve a iniciar sesión.";
      estadoEl.className = "drive-acceso__estado drive-acceso__estado--error";
      btn.disabled = false;
      btn.textContent = "📁 Obtener mi carpeta de Google Drive";
      return;
    }

    fetch(apiBase + "/api/courses/" + CFG.course_id + "/drive-folder", {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json"
      }
    })
    .then(function (r) { return r.json(); })
    .then(function (r) {
      if (r.success && r.data) {
        // GA4: drive_folder_access_success
        trackEvent("drive_folder_access_success", {
          course_id: CFG.course_id,
          user_id: sesion.email,
          course_name: r.data.course_name
        });

        // Enhanced Ecommerce: purchase (access granted)
        trackDriveFolderAccess("purchase", {
          action: "drive_folder_granted",
          transaction_id: "drive_" + CFG.course_id + "_" + sesion.email,
          value: 0,
          currency: CFG.country === "pe" ? "PEN" : "USD"
        });

        // Mostrar el enlace en un modal/overlay bonito
        mostrarDriveModal(r.data.drive_folder_url, r.data.course_name, r.data.message);
        estadoEl.textContent = "✅ Enlace obtenido";
        estadoEl.className = "drive-acceso__estado drive-acceso__estado--ok";
      } else {
        var msg = r.error || "No se pudo obtener la carpeta.";
        if (r.code === "ACCESS_DENIED") msg = "Necesitas acceso completo. Activa tu código primero.";
        if (r.code === "NOT_CONFIGURED") msg = "La carpeta aún no está configurada. Contacta a soporte.";
        if (r.code === "UNAUTHORIZED" || r.code === "INVALID_TOKEN") {
          msg = "Tu sesión ha expirado. Vuelve a iniciar sesión.";
          borrarSesion();
          location.reload();
        }
        // GA4: drive_folder_access_error
        trackEvent("drive_folder_access_error", {
          course_id: CFG.course_id,
          user_id: sesion ? sesion.email : null,
          error_code: r.code || "unknown",
          error_message: msg
        });
        estadoEl.textContent = msg;
        estadoEl.className = "drive-acceso__estado drive-acceso__estado--error";
      }
    })
    .catch(function () {
      trackEvent("drive_folder_access_error", {
        course_id: CFG.course_id,
        user_id: sesion ? sesion.email : null,
        error_code: "network_error",
        error_message: "Error de conexión"
      });
      estadoEl.textContent = "Error de conexión. Intenta de nuevo.";
      estadoEl.className = "drive-acceso__estado drive-acceso__estado--error";
    })
    .finally(function () {
      btn.disabled = false;
      btn.textContent = "📁 Obtener mi carpeta de Google Drive";
    });
  }

  function mostrarDriveModal(url, courseName, mensaje) {
    // Crear modal overlay
    var overlay = document.createElement("div");
    overlay.className = "drive-modal-overlay";
    overlay.innerHTML = `
      <div class="drive-modal" role="dialog" aria-modal="true" aria-labelledby="drive-modal-titulo">
        <button class="drive-modal__cerrar" type="button" aria-label="Cerrar">✕</button>
        <div class="drive-modal__icono" aria-hidden="true">☁️</div>
        <h2 id="drive-modal-titulo">Tu carpeta de <strong>${courseName}</strong></h2>
        <p class="drive-modal__mensaje">${mensaje}</p>
        <div class="drive-modal__url">
          <label for="drive-url-input">Enlace directo a tu carpeta en Google Drive:</label>
          <div class="drive-modal__url-row">
            <input type="text" id="drive-url-input" readonly value="${url}" aria-readonly="true">
            <button class="boton boton--secundario boton--pequeno" id="btn-copiar-drive" type="button">📋 Copiar</button>
          </div>
        </div>
        <div class="drive-modal__acciones">
          <a class="boton boton--principal boton--grande" href="${url}" target="_blank" rel="noopener">🚀 Abrir en Google Drive</a>
          <button class="boton boton--secundario boton--grande" id="btn-cerrar-modal" type="button">Entendido, gracias</button>
        </div>
        <p class="drive-modal__recordatorio">💡 <strong>Tip:</strong> Una vez en Drive, haz clic derecho → «Descargar» para bajar toda la carpeta a tu PC, o «Añadir a Mi unidad» para guardarla en tu cuenta de Google.</p>
      </div>
    `;
    document.body.appendChild(overlay);

    // Event listeners
    var cerrar = function () {
      overlay.classList.add("drive-modal-overlay--oculto");
      setTimeout(function () { overlay.remove(); }, 300);
    };
    overlay.querySelector(".drive-modal__cerrar").addEventListener("click", cerrar);
    overlay.querySelector("#btn-cerrar-modal").addEventListener("click", cerrar);
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) cerrar();
    });
    document.addEventListener("keydown", function esc(e) {
      if (e.key === "Escape") { cerrar(); document.removeEventListener("keydown", esc); }
    });

    // Copiar al portapapeles
    overlay.querySelector("#btn-copiar-drive").addEventListener("click", function () {
      var input = overlay.querySelector("#drive-url-input");
      input.select();
      document.execCommand("copy");
      var btn = overlay.querySelector("#btn-copiar-drive");
      var original = btn.textContent;
      btn.textContent = "✅ ¡Copiado!";
      setTimeout(function () { btn.textContent = original; }, 2000);
    });
  }

  // Mostrar/ocultar panel de Drive según acceso
  function actualizarPanelDrive() {
    var panel = $("drive-acceso-panel");
    if (!panel) return;
    if (estado && completo()) {
      panel.style.display = "block";
    } else {
      panel.style.display = "none";
    }
  }

  /* ---------- Formularios ---------- */

  $("form-registro").addEventListener("submit", function (e) {
    e.preventDefault();
    var nombre = $("reg-nombre").value.trim();
    var email = validarEmail($("reg-email").value);
    var pass = $("reg-password").value;
    if (nombre.length < 2) { trackFormError("registro", "nombre", "too_short"); return mensajeEn("estado-registro", "Escribe tu nombre.", "error"); }
    if (!email) { trackFormError("registro", "email", "invalid_format"); return mensajeEn("estado-registro", "Escribe un email válido.", "error"); }
    if (pass.length < 6) { trackFormError("registro", "password", "too_short"); return mensajeEn("estado-registro", "La contraseña debe tener al menos 6 caracteres.", "error"); }
    mensajeEn("estado-registro", "Creando tu cuenta…");

    // GA4: register_start
    trackEvent("register_start", { method: "email_password" });

    // Usar nueva API v4: /api/auth/register
    apiCall("/api/auth/register", {
      method: "POST",
      body: { course_id: CFG.course_id, name: nombre, email: email, password: pass, country: String(CFG.country).toUpperCase(), origin: origen() }
    }).then(function (r) {
      if (!r.ok) {
        if (r.codigo === "CUENTA_EXISTENTE") return mensajeEn("estado-registro", r.mensaje + " Usa «¿Ya tienes cuenta?».", "error");
        return mensajeEn("estado-registro", r.mensaje || "No pudimos crear tu cuenta.", "error");
      }
      guardarSesion({ token: r.token, email: r.email, whatsapp: r.whatsapp, nombre: r.name });
      // GA4: register_complete
      trackEvent("register_complete", { user_id: r.email, course_id: CFG.course_id, method: "email_password" });
      if (r.must_change) return mostrarCambio();
      entrarAlCurso("¡Listo! Tu cuenta está creada.");
    });
  });

  $("form-entrar").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = validarEmail($("ent-email").value);
    var pass = $("ent-password").value;
    if (!email) { trackFormError("login", "email", "invalid_format"); return mensajeEn("estado-entrar", "Escribe tu email y tu contraseña.", "error"); }
    if (!pass) { trackFormError("login", "password", "empty"); return mensajeEn("estado-entrar", "Escribe tu email y tu contraseña.", "error"); }
    mensajeEn("estado-entrar", "Entrando…");

    // GA4: login_start
    trackEvent("login_start", { method: "email_password" });

    // Usar nueva API v4: /api/auth/login
    apiCall("/api/auth/login", {
      method: "POST",
      body: { email: email, password: pass }
    }).then(function (r) {
      if (!r.ok) return mensajeEn("estado-entrar", r.mensaje || "No pudimos entrar.", "error");
      guardarSesion({ token: r.token, email: r.email, whatsapp: r.whatsapp, nombre: r.name });
      // GA4: login_complete
      trackEvent("login_complete", { user_id: r.email, course_id: CFG.course_id, method: "email_password" });
      if (r.must_change) return mostrarCambio();
      var tieneCurso = (r.courses || []).some(function (c) { return c.course_id === CFG.course_id; });
      if (tieneCurso) return entrarAlCurso("¡Bienvenido de nuevo, " + r.name + "!");
      // Cuenta existente sin este curso: se inscribe con la misma contraseña
      apiCall("/api/auth/register", {
        method: "POST",
        body: { course_id: CFG.course_id, name: r.name, email: r.email, password: pass, country: String(CFG.country).toUpperCase(), origin: origen() }
      }).then(function (x) {
        if (!x.ok) return mensajeEn("estado-entrar", x.mensaje || "No pudimos inscribirte.", "error");
        guardarSesion({ token: x.token, email: x.email, whatsapp: x.whatsapp, nombre: x.name || r.name });
        entrarAlCurso("¡Listo! Ya estás inscrito en este curso.");
      });
    });
  });

  $("form-cambiar").addEventListener("submit", function (e) {
    e.preventDefault();
    var actual = $("cam-actual").value;
    var nueva = $("cam-nueva").value;
    if (nueva.length < 6) { trackFormError("cambiar_password", "nueva", "too_short"); return mensajeEn("estado-cambiar", "La nueva contraseña debe tener al menos 6 caracteres.", "error"); }
    pedir("cambiar_password", { actual: actual, nueva: nueva }).then(function (r) {
      if (!r.ok) return mensajeEn("estado-cambiar", r.mensaje || "No se pudo cambiar.", "error");
      $("cam-actual").value = ""; $("cam-nueva").value = "";
      mostrar("bloque-cambiar", false);
      mostrar("bloque-registro", true);
      entrarAlCurso("Contraseña actualizada.");
    });
  });

  $("form-activar").addEventListener("submit", function (e) {
    e.preventDefault();
    var codigo = $("act-codigo").value.trim();
    if (!sesion) {
      mensajeEn("estado-activar", "Primero entra o crea tu cuenta.", "error");
      location.hash = "#acceso";
      return;
    }
    if (!codigo) { trackFormError("activar", "codigo", "empty"); return mensajeEn("estado-activar", "Escribe tu código.", "error"); }
    mensajeEn("estado-activar", "Verificando código…");

    // GA4: activation_start
    trackEvent("activation_start", { code_prefix: CFG.code_prefix, user_id: sesion.email });

    pedir("activar", { course_id: CFG.course_id, code: codigo }).then(function (r) {
      if (!r.ok) return mensajeEn("estado-activar", r.mensaje || "Código no válido.", "error");
      $("act-codigo").value = "";
      mensajeEn("estado-activar", "¡Listo! Tu curso completo está activo.");
      urlsPago = {};
      // GA4: activation_success
      trackEvent("activation_success", { code_type: "paid", course_id: CFG.course_id, user_id: sesion.email });
      entrarAlCurso();
      actualizarPanelDrive();
      location.hash = "#clases-gratis";
    });
  });

  $("btn-guardar-nota").addEventListener("click", guardarNota);
  $("btn-marcar-vista").addEventListener("click", alternarVista);
  $("btn-anterior").addEventListener("click", function () { moverClase(-1); });
  $("btn-siguiente").addEventListener("click", function () { moverClase(1); });
  $("btn-continuar").addEventListener("click", function (e) {
    e.preventDefault();
    var t = siguienteSinVer();
    if (t) reproducir(t, false);
    location.hash = "#clases-gratis";
  });
  $("btn-obtener-drive").addEventListener("click", obtenerCarpetaDrive);
  $("input-buscar-clase").addEventListener("input", function () {
    filtro = $("input-buscar-clase").value.trim();
    renderTemario();
    // GA4: search
    trackSearch(filtro);
  });
  $("boton-salir").addEventListener("click", function () {
    pedir("logout").then(function () { borrarSesion(); location.reload(); });
  });

  /* ---------- Enlaces de WhatsApp con seguimiento ---------- */

  function mensajeWA(tipo, ref) {
    var v = CFG.seller, n = CFG.courseName, p = CFG.price;
    switch (tipo) {
      case "pagar":   return "Hola " + v + ", ya vi las clases gratis (ref: " + ref + ") y quiero pagar los " + p + " para recibir mi código de acceso.";
      case "duda":    return "Hola " + v + " (ref: " + ref + "), tengo una pregunta sobre " + n + ".";
      case "clave":   return "Hola " + v + ", olvidé mi contraseña del curso " + n + ". ¿Me envías una contraseña temporal? (ref: " + ref + ")";
      default:        return "Hola " + v + ", vengo de la web (ref: " + ref + ") y quiero inscribirme al curso " + n + ": " + p + " pago único, acceso de por vida.";
    }
  }

  function configurarWhatsApp() {
    var ref = origen();
    try { sessionStorage.setItem("mc_ref", ref); } catch (e) {}
    document.querySelectorAll("[data-wa]").forEach(function (a) {
      var tipo = a.getAttribute("data-wa");
      a.href = "https://wa.me/" + CFG.whatsapp + "?text=" + encodeURIComponent(mensajeWA(tipo, ref));
      a.addEventListener("click", function () {
        // GA4: click_whatsapp + purchase_intent para tipo "pagar" e "inscribir"
        trackEvent("click_whatsapp", { tipo: tipo, ref: ref, pais: CFG.country });
        if (tipo === "pagar" || tipo === "inscribir") {
          trackEvent("purchase_intent", {
            tipo: tipo,
            ref: ref,
            pais: CFG.country,
            precio: CFG.price,
            course_id: CFG.course_id,
            currency: CFG.country === "pe" ? "PEN" : "USD"
          });
        }
      });
    });
  }

  /* ---------- Arranque ---------- */
  (function iniciar() {
    initSessionTracking();
    initScrollTracking();
    initVideoProgressTracking();
    initVideoPlayTracking();
    configurarWhatsApp();
    sesion = leerSesion();
    cargarPublico().then(function () {
      if (!sesion) {
        ocultarSegunModo();
        reproducir(publico && publico.clases.length ? publico.clases[0].lesson_id : null, true);
        return;
      }
      entrarAlCurso().then(function (ok) {
        if (!ok) {
          // Sesión válida pero sin inscripción en este curso: modo visitante con la sesión guardada
          ocultarSegunModo();
          reproducir(publico && publico.clases.length ? publico.clases[0].lesson_id : null, true);
        }
      });
    });
  })();
})();
