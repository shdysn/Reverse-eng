/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ide: {
          bg: '#0d1117',
          surface: '#161b22',
          hover: '#21262d',
          input: '#010409',
          border: '#30363d',
          text: '#c9d1d9',
          muted: '#8b949e',
          accent: '#2f81f7',
          success: '#238636',
          warning: '#d29922',
          error: '#f85149',
        },
      },
    },
  },
  plugins: [],
};
