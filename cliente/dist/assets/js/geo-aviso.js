/* Aviso de país: si la persona parece estar en el otro país, le ofrece ir a su versión.
   No redirige solo. Usa la zona horaria y el idioma del navegador; no usa servicios externos.
   Configuración: window.GEO_AVISO (la inyecta build.js). */
(function () {
  "use strict";
  var G = window.GEO_AVISO;
  if (!G || typeof document === "undefined") return;

  var LLAVE = "mc_aviso_pais";
  var DIAS_SILENCIO = 30;

  // Devuelve el código de país ("VE", "PE") o null si no se puede saber.
  function detectar(zona, idioma) {
    if (zona === "America/Caracas") return "VE";
    if (zona === "America/Lima") return "PE";
    var l = String(idioma || "").toLowerCase();
    if (l === "es-ve") return "VE";
    if (l === "es-pe") return "PE";
    return null;
  }

  function silenciado() {
    try {
      var t = Number(localStorage.getItem(LLAVE));
      return t && Date.now() - t < DIAS_SILENCIO * 86400000;
    } catch (e) { return false; }
  }
  function silenciar() { try { localStorage.setItem(LLAVE, String(Date.now())); } catch (e) {} }
  function evento(nombre) { if (typeof window.gtag === "function") window.gtag("event", nombre, { pais_pagina: G.pais }); }

  var zona = "";
  try { zona = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
  var detectado = detectar(zona, navigator.language);
  if (!detectado || detectado === G.pais || silenciado()) return;

  var m = G.mensajes[detectado];
  if (!m) return;

  function mostrar() {
    var barra = document.createElement("div");
    barra.className = "aviso-pais";
    barra.setAttribute("role", "region");
    barra.setAttribute("aria-label", "Cambiar de país");

    var p = document.createElement("p");
    p.className = "aviso-pais__texto";
    p.textContent = "📍 " + m.texto;

    var acciones = document.createElement("div");
    acciones.className = "aviso-pais__acciones";

    var ir = document.createElement("a");
    ir.className = "boton boton--principal";
    ir.href = m.ruta + (location.search || "");
    ir.textContent = m.ir;
    ir.addEventListener("click", function () { silenciar(); evento("aviso_pais_ir"); });

    var quedar = document.createElement("button");
    quedar.type = "button";
    quedar.className = "boton boton--secundario";
    quedar.textContent = "Quedarme aquí";
    quedar.addEventListener("click", function () { silenciar(); evento("aviso_pais_quedarse"); barra.remove(); });

    acciones.appendChild(ir);
    acciones.appendChild(quedar);
    barra.appendChild(p);
    barra.appendChild(acciones);
    document.body.insertBefore(barra, document.body.firstChild);
    evento("aviso_pais_mostrado");
  }
  if (document.body) mostrar(); else document.addEventListener("DOMContentLoaded", mostrar);
})();
