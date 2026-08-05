# 100 Furros Dijeron

Base web para un concurso de encuestas en vivo con:

- pantalla pública sincronizada;
- registro individual con nombre;
- número automático de equipos según la cantidad de participantes;
- capitanes elegidos al azar;
- nombre de equipo elegido por cada capitán;
- selección de integrantes mediante draft serpiente;
- tablero de respuestas, errores y puntos;
- edición de contenido con Pages CMS;
- importación semanal de respuestas de Microsoft Forms mediante Excel.

## Direcciones del sitio

Después de publicar el repositorio con GitHub Pages:

- `index.html`: pantalla pública que todos ven;
- `jugar.html`: entrada de participantes;
- `control.html`: cabina privada del organizador.

Puedes añadir el código de sala a la dirección:

```text
index.html?sala=FURROS
jugar.html?sala=FURROS
```

## 1. Crear el repositorio

1. Crea un repositorio nuevo en GitHub, por ejemplo `100-furros-dijeron`.
2. Sube todos los archivos de esta carpeta conservando la estructura.
3. En **Settings → Pages → Source**, elige **GitHub Actions**.
4. Abre la pestaña **Actions** y permite los workflows si GitHub lo solicita.

El workflow `.github/workflows/pages.yml` publicará el sitio.

## 2. Conectar Pages CMS

1. Entra a `https://app.pagescms.org/`.
2. Inicia sesión con GitHub e instala la aplicación para este repositorio.
3. Abre el repositorio y selecciona la rama `main`.
4. Pages CMS detectará `.pages.yml` en la raíz.

Desde Pages CMS podrás editar:

- nombre del programa;
- subtítulo;
- código de sala;
- límites de equipos;
- Excel semanal;
- columnas ignoradas;
- sinónimos o variantes de respuestas;
- preguntas procesadas, respuestas, puntos y multiplicadores.

## 3. Conectar Firebase

GitHub Pages aloja la interfaz. Firebase Realtime Database mantiene a todas las personas viendo el mismo estado.

### Crear el proyecto

1. Crea un proyecto en Firebase.
2. Registra una aplicación web.
3. Activa **Authentication**:
   - proveedor **Anónimo** para jugadores;
   - proveedor **Correo/contraseña** para el organizador.
4. Crea una **Realtime Database**.
5. Copia la configuración de la aplicación web en:

```text
config/firebase-config.js
```

### Instalar las reglas

Copia el contenido de:

```text
firebase/database.rules.json
```

en **Realtime Database → Rules** y publícalo.

### Autorizar al organizador

1. Crea el usuario del organizador en **Authentication → Users**.
2. Inicia sesión una vez en `control.html`.
3. Si aún no está autorizado, la cabina mostrará su UID.
4. En Realtime Database crea manualmente:

```text
admins
  UID_DEL_ORGANIZADOR: true
```

El correo y la contraseña no se guardan en GitHub.

## 4. Flujo de equipos

1. El organizador crea o reinicia una sala desde `control.html`.
2. Cada persona entra desde `jugar.html` y escribe su nombre.
3. El organizador cierra el registro.
4. Pulsa **Sortear capitanes y equipos**.
5. La cantidad de equipos se calcula así:
   - 4 a 8 personas: 2 equipos;
   - 9 a 15: 3 equipos;
   - 16 a 24: 4 equipos;
   - 25 a 35: 5 equipos;
   - 36 o más: hasta 6 equipos.
6. Cada capitán elige el nombre desde su teléfono.
7. El organizador pulsa **Iniciar draft**.
8. Los capitanes eligen personas por turnos con orden serpiente.
9. Cuando todos tienen equipo, el organizador inicia el concurso.

La cabina debe permanecer abierta durante la selección porque valida las solicitudes de los capitanes.

## 5. Actualización semanal con Microsoft Forms

El formulario debe tener una pregunta de encuesta por columna. El Excel puede conservar columnas administrativas como `ID`, `Start time`, `Completion time`, `Email` y `Name`; el importador las ignora.

### Desde Pages CMS

1. Abre **Importación semanal**.
2. En **Excel de Microsoft Forms**, sube el archivo `.xlsx`.
3. Cambia el nombre de la semana.
4. Revisa **Columnas que no son preguntas**.
5. Añade equivalencias cuando varias respuestas significan lo mismo.
6. Guarda.
7. Pulsa la acción **Procesar Excel semanal**.

El workflow:

1. abre el Excel;
2. cuenta las respuestas de cada columna;
3. agrupa mayúsculas, tildes y variantes configuradas;
4. genera `content/questions.json`;
5. guarda el resultado en GitHub;
6. vuelve a publicar GitHub Pages.

Se incluye `uploads/respuestas.xlsx` como archivo de ejemplo. Sustitúyelo por la descarga real de Microsoft Forms.

## Equivalencias de respuestas

En Pages CMS puedes configurar:

```text
Pregunta exacta: Algo que un furro lleva a una convención.
Respuesta que aparecerá: Fursuit
Variantes: fursuit, traje furry, traje, suit
```

Así todas cuentan como una sola respuesta.

## Seguridad importante

- La configuración pública de Firebase puede estar en el navegador; la seguridad real depende de las reglas de Realtime Database.
- No uses reglas abiertas de prueba al publicar.
- Solo los UID incluidos en `/admins` pueden modificar la partida.
- Los jugadores anónimos únicamente pueden escribir su propio nombre y sus solicitudes.

## Archivos principales

```text
index.html                         pantalla pública
jugar.html                         portal de jugadores
control.html                       cabina del organizador
assets/js/public.js                render del show
assets/js/player.js                registro, capitanes y draft
assets/js/control.js               administración de la partida
assets/js/firebase-service.js      sincronización en vivo
content/settings.json              configuración general
content/import-settings.json       reglas del Excel
content/questions.json             preguntas semanales
uploads/respuestas.xlsx            Excel de ejemplo
.pages.yml                         Pages CMS
.github/workflows/import-excel.yml importación semanal
.github/workflows/pages.yml        publicación
```
