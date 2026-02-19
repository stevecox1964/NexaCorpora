function applySize() {
  document.body.style.width = window.innerWidth + 'px';
  document.body.style.height = window.innerHeight + 'px';
}
applySize();
window.addEventListener('resize', applySize);
