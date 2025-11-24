const isDarkMode = localStorage.getItem('dark_mode') === 'true';
const darkToggle = document.getElementById('darkModeToggle');

if (darkToggle) {
    darkToggle.checked = isDarkMode;
    // Appliquer la classe si sauvegardé
    if (isDarkMode) document.body.classList.add('dark-mode');

    // Écouteur pour le changement immédiat
    darkToggle.addEventListener('change', (e) => {
        if (e.target.checked) {
            document.body.classList.add('dark-mode');
            localStorage.setItem('dark_mode', 'true');
        } else {
            document.body.classList.remove('dark-mode');
            localStorage.setItem('dark_mode', 'false');
        }
    });
}

// if loaded and dark mode, apply class
if (isDarkMode) {
    document.body.classList.add('dark-mode');
} else {
    document.body.classList.remove('dark-mode');
}