/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#25233a',
        lilac: '#9279f7',
        'lilac-dark': '#765be0',
        'lilac-light': '#f0edff',
        'warm-white': '#fbfaff',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 24px 80px rgba(53, 43, 108, 0.1)',
      },
    },
  },
  plugins: [],
};
