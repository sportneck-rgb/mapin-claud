// Niveles de habilidad según los likes de la comunidad.
// 5 likes = primer nivel; luego sube un nivel cada 10 likes. Ajusta INICIO y PASO a tu gusto.
const INICIO = 5;
const PASO = 10;
const RANGOS = [
  { nombre: 'Aprendiz de 2º',     chev: 1, estrellas: 0, tono: 'bronce' },
  { nombre: 'Aprendiz de 1º',     chev: 2, estrellas: 0, tono: 'bronce' },
  { nombre: 'Principiante de 2º', chev: 3, estrellas: 0, tono: 'bronce' },
  { nombre: 'Principiante de 1º', chev: 4, estrellas: 0, tono: 'bronce' },
  { nombre: 'Intermedio de 4º',   chev: 0, estrellas: 1, tono: 'plata' },
  { nombre: 'Intermedio de 3º',   chev: 0, estrellas: 2, tono: 'plata' },
  { nombre: 'Intermedio de 2º',   chev: 0, estrellas: 1, tono: 'oro' },
  { nombre: 'Intermedio de 1º',   chev: 0, estrellas: 2, tono: 'oro' },
  { nombre: 'Avanzado de 4º',     chev: 0, estrellas: 3, tono: 'oro' },
  { nombre: 'Avanzado de 3º',     chev: 0, estrellas: 1, tono: 'oro', aro: true },
  { nombre: 'Avanzado de 2º',     chev: 0, estrellas: 2, tono: 'oro', aro: true },
  { nombre: 'Avanzado de 1º',     chev: 0, estrellas: 3, tono: 'oro', aro: true },
  { nombre: 'Experto de 3º',      chev: 0, estrellas: 1, tono: 'rojo' },
  { nombre: 'Experto de 2º',      chev: 0, estrellas: 2, tono: 'rojo' },
  { nombre: 'Experto de 1º',      chev: 0, estrellas: 3, tono: 'rojo' }
];

function indiceRango(likes) {
  if (likes < INICIO) return -1;
  return Math.min(Math.floor((likes - INICIO) / PASO), RANGOS.length - 1);
}
function rangoDe(likes) { return RANGOS[indiceRango(likes)] || null; }
// Próximo grado: { nombre, faltan } o null si ya es el máximo
function siguienteRango(likes) {
  const i = indiceRango(likes);
  if (i >= RANGOS.length - 1) return null;
  return { nombre: RANGOS[i + 1].nombre, faltan: INICIO + (i + 1) * PASO - likes };
}
if (typeof module !== 'undefined') module.exports = { RANGOS, rangoDe, siguienteRango, indiceRango };
