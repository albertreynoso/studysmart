# Reglas Firebase — StudySmart (proyecto compartido `trackit-e6792`)

> ⚠️ **NO ejecutes `firebase deploy` de reglas desde este repo.** Sobrescribiría las reglas de
> Trackit. `firebase.json` aquí despliega **solo hosting**. Estas reglas se **fusionan a mano**
> en la consola Firebase (Firestore → Reglas / Storage → Reglas) sin tocar lo existente de Trackit.

## Estado actual: SIN login (opción 2, reglas dev abiertas)

Temporal hasta añadir Firebase Auth (Fase 5). Abre **solo** las rutas de StudySmart
(`packages/`, `sessions/`), no las colecciones de Trackit.

### Firestore — añadir dentro de `match /databases/{database}/documents { ... }`

```
// StudySmart — bancos de estudio + sesiones (dev, sin auth). Endurecer con auth después.
match /packages/{slug} {
  allow read, write: if true;
}
match /sessions/{id} {
  allow read, write: if true;
}
```

### Storage — añadir dentro de `match /b/{bucket}/o { ... }`

```
// StudySmart — cuerpos JSON + imágenes de paquetes (dev, sin auth).
match /packages/{allPaths=**} {
  allow read, write: if true;
}
```

## Cuando añadas login (Fase 5)

Reemplaza `if true` por `if request.auth != null` en los 3 bloques. Con un solo usuario basta;
si quieres restringir a tu UID: `if request.auth.uid == "TU_UID"`.

## Deploy de la web

```
npm run build
firebase deploy --only hosting
```

Queda en `https://trackit-e6792.web.app`.
