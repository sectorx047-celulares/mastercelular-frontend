/* Genera el sitio final en dist/ a partir de:
     src/plantilla.html  (diseño compartido por todos los países y cursos)
     paises/*.json       (precio, moneda, WhatsApp, vendedor, métodos de pago, mercado)
     cursos/*.json       (textos de venta, beneficios, FAQ, testimonios, analítica)
   Uso: node build.js */
const fs = require("fs");
const path = require("path");

const RAIZ = __dirname;
const SRC = path.join(RAIZ, "src");
const DIST = path.join(RAIZ, "dist");
const avisos = new Set();

const leerJSON = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const listarJSON = (carpeta) =>
  fs.readdirSync(path.join(RAIZ, carpeta)).filter((f) => f.endsWith(".json"))
    .map((f) => leerJSON(path.join(RAIZ, carpeta, f)));

const paises = listarJSON("paises");
const cursos = listarJSON("cursos");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Sustituye {{CLAVE}} en textos de datos (precio, vendedor, etc.). Sin escapar: se escapa al final.
function pl(texto, ctx) {
  return String(texto).replace(/\{\{([A-Z_]+)\}\}/g, (todo, k) => (k in ctx ? ctx[k] : todo));
}

function rutaPagina(curso, pais) {
  const base = curso.ruta_base ? "/" + curso.ruta_base.replace(/^\/+|\/+$/g, "") : "";
  return (base + pais.ruta).replace(/\/{2,}/g, "/").replace(/\/?$/, "/");
}

function pendiente(valor, donde) {
  if (!valor || String(valor).includes("REEMPLAZAR")) avisos.add(`Pendiente en ${donde}: ${valor || "(vacío)"}`);
}

function fechaLarga(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function seccionMercado(pais, ctx) {
  const m = pais.mercado;
  if (!m) return "";
  const enc = m.encabezados.map((h) => `<th scope="col">${esc(h)}</th>`).join("");
  const filas = m.filas.map((f) => `<tr>${f.map((c) => `<td>${esc(pl(c, ctx))}</td>`).join("")}</tr>`).join("\n            ");
  return `<section class="seccion venta-only" id="mercado" aria-labelledby="titulo-mercado">
      <h2 class="seccion__titulo" id="titulo-mercado">${esc(pl(m.titulo, ctx))}</h2>
      <p class="seccion__sub">${esc(pl(m.sub, ctx))}</p>
      <div class="tabla-contenedor">
        <table class="tabla-ganancias">
          <thead><tr>${enc}</tr></thead>
          <tbody>
            ${filas}
          </tbody>
        </table>
      </div>
      <p class="nota-legal">${esc(pl(m.nota, ctx))}</p>
    </section>`;
}

function seccionTestimonios(curso) {
  const t = curso.testimonios || [];
  if (!t.length) return "";
  const tarjetas = t.map((x) => `<article class="tarjeta"><p>“${esc(x.texto)}”</p><p><strong>${esc(x.autor)}</strong></p></article>`).join("\n          ");
  return `<section class="seccion venta-only" id="testimonios" aria-labelledby="titulo-testimonios">
      <h2 class="seccion__titulo" id="titulo-testimonios">Lo que dicen nuestros alumnos</h2>
      <div class="grid-tarjetas">
          ${tarjetas}
      </div>
    </section>`;
}

function construirPagina(curso, pais) {
  const ruta = rutaPagina(curso, pais);
  const canonical = curso.dominio + ruta;
  const ctx = {
    VENDEDOR: pais.vendedor,
    PRECIO: pais.precio_texto,
    METODOS_PAGO: pais.metodos_pago,
    MARCA: pais.marca,
    PREFIJO_CODIGO: curso.prefijo_codigo || "CUR"
  };
  const titulo = pl(curso.titulo_seo || curso.nombre, ctx) + " | " + pais.marca;

  pendiente(pais.whatsapp, `whatsapp de ${pais.marca}`);
  pendiente(curso.endpoint, `endpoint de ${curso.slug}`);

  const hreflang = paises.map((p) => `<link rel="alternate" hreflang="${p.idioma}" href="${curso.dominio + rutaPagina(curso, p)}">`);
  const principal = paises.find((p) => p.ruta === "/") || paises[0];
  hreflang.push(`<link rel="alternate" hreflang="x-default" href="${curso.dominio + rutaPagina(curso, principal)}">`);

  const jsonld = {
    "@context": "https://schema.org",
    "@type": "Course",
    name: curso.nombre,
    description: pl(curso.descripcion, ctx),
    inLanguage: pais.idioma,
    provider: { "@type": "Organization", name: pais.marca, url: canonical },
    offers: { "@type": "Offer", price: String(pais.precio), priceCurrency: pais.moneda,
      availability: "https://schema.org/InStock", url: canonical }
  };

  // Aviso de país: mensajes para cada versión, según los datos de cada país
  const geo = {
    pais: pais.codigo.toUpperCase(),
    alt: "",
    mensajes: {}
  };
  paises.forEach((p) => {
    geo.mensajes[p.codigo.toUpperCase()] = {
      texto: `Parece que nos visitas desde ${p.nombre}. Tenemos una versión para ${p.nombre}, con precio de ${p.precio_texto} y atención por ${p.vendedor}.`,
      ir: `Ir a la versión de ${p.nombre}`,
      ruta: rutaPagina(curso, p)
    };
  });

  const analitica = curso.analitica
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(curso.analitica)}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${esc(curso.analitica)}');</script>`
    : "";

  // GTM (Google Tag Manager) - opcional
  const gtm = curso.analitica_gtm
    ? `<!-- Google Tag Manager -->
  <script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${esc(curso.analitica_gtm)}');</script>
  <!-- End Google Tag Manager -->`
    : "";

  // GTM noscript (para body)
  const gtm_noscript = curso.analitica_gtm
    ? `<!-- Google Tag Manager (noscript) -->
  <noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${esc(curso.analitica_gtm)}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
  <!-- End Google Tag Manager (noscript) -->`
    : "";

  const config = {
    country: pais.codigo,
    countryName: pais.nombre,
    seller: pais.vendedor,
    price: pais.precio_texto,
    course_id: curso.curso_id,
    courseName: curso.nombre,
    brand: pais.marca,
    whatsapp: pais.whatsapp,
    code_prefix: curso.prefijo_codigo || "CUR",
    // whatsapp/prefijo removidos - ahora se usa email
    endpoint: curso.endpoint, // legacy v3, mantener por compatibilidad temporal
    autoplayPrimeraClase: curso.autoplayPrimeraClase !== false,
    autoplaySilenciado: curso.autoplaySilenciado !== false,
    apiBase: "https://mastercelular-api.sectorx047.workers.dev"
  };

  const aviso = curso.oferta_hasta
    ? `<p class="oferta__aviso" id="aviso-oferta">Oferta válida hasta el ${fechaLarga(curso.oferta_hasta)}.</p>`
    : `<p class="oferta__aviso oculto" id="aviso-oferta"></p>`;

  const faq = curso.faq
    .filter((f) => !f.solo_pais || f.solo_pais.toLowerCase() === pais.codigo)
    .map((f) => `<details class="faq-item">
          <summary class="faq-item__pregunta">${esc(pl(f.pregunta, ctx))}</summary>
          <p class="faq-item__respuesta">${esc(pl(f.respuesta, ctx))}</p>
        </details>`).join("\n        ");

  const aprenderas = curso.aprenderas.map((a) => `<article class="tarjeta">
            <span class="tarjeta__icono" aria-hidden="true">${a.icono}</span>
            <h3>${esc(pl(a.titulo, ctx))}</h3>
            <p>${esc(pl(a.texto, ctx))}</p>
          </article>`).join("\n          ");

  const bonos = curso.bonos.map((b) => `<li>${b.icono} <strong>${esc(pl(b.titulo, ctx))}</strong> ${esc(pl(b.texto, ctx))}</li>`).join("\n          ");

  const incluye = curso.incluye.map((i) => `<li>${esc(pl(i, ctx))}</li>`).join("\n          ");

  const pasos = curso.pasos.map((p) => `<li>${esc(pl(p, ctx))}</li>`).join("\n          ");

  const reemplazos = {
    LANG: pais.idioma,
    TITULO: esc(titulo),
    DESCRIPCION: esc(pl(curso.descripcion, ctx)),
    CANONICAL: esc(canonical),
    HREFLANG: hreflang.join("\n  "),
    OG_LOCALE: pais.og_locale,
    OG_IMAGEN: esc(curso.dominio + (curso.imagen_og || "/assets/img/og-default.jpg")),
    MARCA: esc(pais.marca),
    JSONLD: `<script type="application/ld+json">\n  ${JSON.stringify(jsonld, null, 2)}\n  </script>`,
    ANALITICA: analitica,
    GTM: gtm,
    GTM_NOSCRIPT: gtm_noscript,
    GEO_AVISO: `<script>window.GEO_AVISO = ${JSON.stringify(geo).replace(/</g, "\\u003c")};</script>`,
    TITULAR: esc(pl(curso.titular, ctx)),
    SUBTITULO: esc(pl(curso.subtitulo, ctx)),
    IMAGEN_ALT: esc(pl(curso.imagen_alt, ctx)),
    PRECIO: esc(pais.precio_texto),
    METODOS_PAGO: esc(pais.metodos_pago),
    VENDEDOR: esc(pais.vendedor),
    PREFIJO_CODIGO: esc(ctx.PREFIJO_CODIGO),
    APRENDERAS: aprenderas,
    MERCADO: seccionMercado(pais, ctx),
    BONOS: bonos,
    TESTIMONIOS: seccionTestimonios(curso),
    INCLUYE: incluye,
    OFERTA_AVISO: aviso,
    PASOS: pasos,
    FAQ: faq,
    ANIO: String(new Date().getFullYear()),
    POLITICAS: pais.politicas ? `<p><a href="${esc(pais.politicas)}">Políticas de privacidad</a></p>` : "",
    CONFIG: `<script>window.CONFIG = ${JSON.stringify(config).replace(/</g, "\\u003c")};</script>`
  };

  let html = fs.readFileSync(path.join(SRC, "plantilla.html"), "utf8");
  html = html.replace(/\{\{([A-Z_]+)\}\}/g, (todo, clave) => {
    if (!(clave in reemplazos)) throw new Error(`Marcador sin valor: {{${clave}}}`);
    return reemplazos[clave];
  });
  return { ruta, canonical, html };
}

// ----- Construcción -----
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const urls = [];
cursos.forEach((curso) => {
  paises.forEach((pais) => {
    const { ruta, canonical, html } = construirPagina(curso, pais);
    const destino = path.join(DIST, ruta, "index.html");
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, html, "utf8");
    urls.push(canonical);
    console.log(`✓ ${pais.marca} → ${ruta}`);
  });
});

// Assets compartidos (una sola fuente: src/assets/)
fs.cpSync(path.join(SRC, "assets"), path.join(DIST, "assets"), { recursive: true });

const dominio = cursos[0].dominio;
fs.writeFileSync(path.join(DIST, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") + `\n</urlset>\n`);
fs.writeFileSync(path.join(DIST, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${dominio}/sitemap.xml\n`);

console.log(`\nSitio generado en dist/ (${urls.length} páginas).`);
if (avisos.size) {
  console.log("\nPendientes antes de publicar:");
  avisos.forEach((a) => console.log("  - " + a));
}
