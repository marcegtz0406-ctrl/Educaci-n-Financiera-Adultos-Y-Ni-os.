# Jeopardy: Educación Financiera - Estudio A
## "La Película de tu Vida" (Branch A vs Branch B)
### Proyecto "El Set de Cine": Activación Interactiva • UACM

Juego interactivo multijugador en tiempo real estilo Kahoot: 4 opciones en el celular y puntos por rapidez, sintetizador de voz con Web Speech API en español latino, generador dinámico de código QR, tablero 5x5 con taxonomía de Bloom y podio olímpico con lluvia de confeti.

---

## 🚀 Despliegue en Render (Paso a Paso)

1. Sube este repositorio a **GitHub**.
2. Entra a tu panel en [Render.com](https://render.com) y haz clic en **New +** -> **Web Service**.
3. Conecta tu repositorio de GitHub.
4. Configura los parámetros:
   - **Environment:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** `Free` (o el de tu preferencia).
5. Haz clic en **Create Web Service**. ¡Listo! Render te proporcionará tu URL pública permanente (ej: `https://jeopardy-finanzas.onrender.com`).

---

## 💻 Ejecución Local

1. Instala dependencias:
   ```bash
   npm install
   ```
2. Inicia el servidor:
   ```bash
   node server.js
   ```
3. Abre en tu navegador:
   - **Pantalla del Docente / Proyector:** [http://localhost:3000](http://localhost:3000)
   - **Celulares de los participantes:** [http://localhost:3000/buzzer.html](http://localhost:3000/buzzer.html)

---

## 🎮 Cómo se juega (modo Kahoot)

1. El docente elige una casilla del tablero. La pregunta y sus **4 opciones de colores** (en orden aleatorio) aparecen en el proyector y en los celulares, pero los celulares están **bloqueados**.
2. El docente presiona **🔊 Leer en voz alta** (`[L]`): el navegador lee la pregunta y las opciones por color ("opción roja, opción azul…"), para quienes todavía no leen con soltura.
3. El docente presiona **▶️ Iniciar** (`[Espacio]`). En los celulares aparece **¡YA!** y se desbloquean las opciones. Solo una es correcta.
4. Cada participante tiene **40 segundos** (niñas y niños) o **30 segundos** (personas adultas) para elegir. Si acierta, gana entre el **100% y el 50%** del valor de la casilla: entre más rápido responde, más puntos. Las respuestas incorrectas dan 0 puntos (no restan).
5. Cuando todos responden o se acaba el tiempo, la respuesta correcta se revela sola, con la gráfica de cuántos eligieron cada opción y quién ganó más puntos.
6. Botón **🤖 Reflexión IA**: después de revelar, lee en voz alta (`es-MX` / `es-419`) la lección pedagógica.
7. **🏆 Final Jeopardy** funciona igual, con un valor máximo de 500 puntos. Gana quien junte más puntos (**👑 Podio y Ganador**).

El docente ya no califica: no hay botones de Correcto/Incorrecto ni ajustes manuales de puntos.

### Atajos de teclado
- `[L]`: Leer en voz alta la pregunta y las opciones (otra vez `[L]` para detener).
- `[Espacio]`: Iniciar el tiempo para responder.
- `[Esc]`: Volver al tablero.
- Botón **⏹️ Cerrar respuestas**: termina el tiempo antes de los 30 s y revela la respuesta.

### Público y preguntas (carpeta `preguntas/`)
Al abrir el proyector se elige **quién va a jugar**. El botón **👥 Público** de arriba permite cambiarlo entre partidas (al cambiar se reinician el tablero y los puntos):

| Público | Archivo | Tiempo por pregunta |
|---|---|---|
| 👧🧒 Niñas y niños (6 a 12 años) | `preguntas/ninos.json` | 40 s |
| 🧑 Personas adultas (vida diaria, sin tecnicismos) | `preguntas/adultos.json` | 30 s |

En los dos, las preguntas de $100 son las más fáciles y las de $500 tienen más reto. Las preguntas originales (más técnicas) siguen guardadas en `preguntas/adultos_original_tecnico.json`; para usarlas, cópialas encima de `preguntas/adultos.json` y reinicia el servidor.

Cada pregunta tiene 4 opciones: `opcion_branch_b` es **siempre la correcta**; `opcion_branch_a` y las dos de `distractores` son incorrectas. El juego las mezcla en cada partida. Este archivo no se envía a los navegadores, así que los participantes no pueden ver las respuestas.

Para usar el mismo tiempo en los dos públicos, define la variable de entorno `ANSWER_TIME_MS` (por ejemplo `ANSWER_TIME_MS=35000 node server.js` para 35 s).


### Jugadores
Cada quien juega con su celular y su propio nombre. Si alguien intenta entrar con un nombre que ya usa otro celular conectado, se le pide agregar una inicial o un número. Si un celular se recarga o se desconecta, vuelve a entrar con el mismo nombre y conserva sus puntos.

### Voz
La lectura en voz alta y la Reflexión IA usan las voces del navegador. Prueba el botón 🔊 antes del evento en la computadora del proyector. Si no se escucha nada en Ubuntu, prueba con Google Chrome o instala las voces del sistema: `sudo apt install speech-dispatcher espeak-ng`.

---

## 🛠️ Solución de problemas

**"Le doy a ¡Entendido, Iniciar Juego! y no aparece el tablero" o "los celulares no se conectan"**
El juego necesita su servidor de Node. **No** funciona si abres `public/index.html` con doble clic, con *Live Server* de VS Code o en un hosting de páginas estáticas (GitHub Pages, Netlify, etc.). En esos casos la pantalla muestra un aviso rojo.

- **En tu computadora:** abre una terminal en la carpeta del proyecto, ejecuta `npm install` (solo la primera vez) y luego `node server.js`. Entra a **http://localhost:3000**.
- **En internet:** usa tu servicio web de Render (ver arriba). En el plan gratuito, la primera visita después de un rato puede tardar ~1 minuto mientras el servidor "despierta".
- Si cambiaste archivos y el navegador sigue mostrando la versión anterior, recarga con **Ctrl + F5** (o **Cmd + Shift + R** en Mac).
