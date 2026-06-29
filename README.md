# 🌱 Garden Designer

A simple, plan-mode PWA for designing your garden on top of real satellite imagery. Search your address, lock the aerial view, and start placing trees, beds, paths, ponds, and more.

**Live:** https://leonlindblad.github.io/garden-designer

## Features
- 🗺️ **Satellite background** — search your address, frame your plot, lock it
- ✏️ **Plan mode** — drag, resize, rotate objects on a stable canvas
- 🌿 **30+ garden objects** — trees, shrubs, lawns, raised beds, paths, patios, sheds, ponds, benches, fire pits…
- 📐 **Real scale** — objects are sized in metres; a scale bar keeps you honest
- 💾 **Auto-save** to your browser + **JSON import/export** + **PNG export**
- ↩️ **Undo/redo**, grid snap, labels
- 📱 **Installable PWA** — add to home screen, works on touch

## Setup (one-time, ~2 minutes)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Enable **Maps JavaScript API**, **Geocoding API**, and **Maps Static API**
3. Create an API key (Credentials → Create credentials → API key)
4. (Recommended) Restrict it to your website URL + those 3 APIs
5. Paste it into the app. It is stored only in your browser.

## How to use
1. Enter your API key
2. Search your address → pan/zoom to frame your garden → **Lock as background**
3. Tap a category in the bottom panel, pick an object, tap the map to place it
4. Tap an object to select it → drag to move, handles to resize/rotate, panel to edit
5. ☰ menu → export PNG (for sharing/printing) or JSON (backup)

## Tech
Vanilla JS + SVG drawing layer over the Google Maps JS API. No build step, no backend. Objects are anchored in latitude/longitude + metres, so they stay put in the real world.

## License
MIT
