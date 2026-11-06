# AxioTune — Official Liquid Glass Specification (BitChord / Apple Music / Haze Standard)

> **MANDATORY SPECIFICATION FOR ALL AGENTS & DEVELOPERS**
> Whenever creating, modifying, or refining any glass, header, navigation, card, or modal element in AxioTune, you **MUST** strictly adhere to this exact specification. Never create flat, opaque, gray-tinted, or harsh-bordered boxes.

---

## 1. The 5 Core Principles of Liquid Glass

### 1.1 No Flat 1px Solid Gray Borders (The Polished Meniscus Rule)
- **Forbidden**: `border: 1px solid #333;` or `border: 1px solid rgba(255, 255, 255, 0.2);` which creates a cheap rectangular wireframe box.
- **Required**: A physical optical meniscus. Light hits the top edge of real curved glass, casting a crisp specular highlight at the top, fading to transparent on the sides and bottom.
- **The Specular Highlight Formula**:
  ```css
  box-shadow: 
    inset 0 1px 1px 0 rgba(255, 255, 255, 0.35),   /* Top razor specular reflection */
    inset 0 0 0 1px rgba(255, 255, 255, 0.08),     /* Subtle refractive contour */
    0 12px 36px -4px rgba(0, 0, 0, 0.45);          /* Deep atmospheric shadow */
  ```

### 1.2 Ultra-Translucent Fill with High-Vibrancy Chromatic Saturation
- **Forbidden**: Murky black/gray opaque fills (`background: rgba(0,0,0,0.85)` or `#121212`) that hide the dynamic WebGL/artwork canvas behind it.
- **Required**: Ultra-thin luminous sheet that absorbs and amplifies background hues:
  ```css
  background: linear-gradient(
    135deg, 
    rgba(255, 255, 255, 0.08) 0%, 
    rgba(255, 255, 255, 0.02) 100%
  );
  -webkit-backdrop-filter: blur(36px) saturate(210%) brightness(1.04);
  backdrop-filter: blur(36px) saturate(210%) brightness(1.04);
  ```

### 1.3 Floating Island Geometry (Capsules & Islands)
- BitChord and iOS 18 glass elements float like polished river stones.
- Use generous border-radii (`border-radius: 9999px` for search bars/pills, `border-radius: 24px` to `28px` for cards/panels).
- Never touch screen boundaries with hard edges; leave breathing room so the background liquid shader flows around all four sides.

### 1.4 Seamless Progressive Fade (The Zero-Demarcation-Line Rule)
- When a glass header must extend down from the top edge, **NEVER** clip the blur abruptly at `height: 72px`.
- Extend the glass backdrop container downwards (`bottom: -40px` or `-48px`) and mask it smoothly:
  ```css
  /* Perfect progressive blur without harsh horizontal cutoff */
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: -44px;
  pointer-events: none;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0.35) 60%, rgba(0, 0, 0, 0) 100%);
  -webkit-backdrop-filter: blur(28px) saturate(180%);
  backdrop-filter: blur(28px) saturate(180%);
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%);
  mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%);
  ```

### 1.5 Interactive Fluid Reaction
- On hover, glass increases in specular brightness and micro-scale:
  ```css
  transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  /* Hover */
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.04) 100%);
  box-shadow: 
    inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.45),
    inset 0 0 0 1px rgba(255, 255, 255, 0.14),
    0 16px 40px -4px rgba(0, 0, 0, 0.55);
  transform: translateY(-1px) scale(1.01);
  ```

---

## 2. Reusable Component Recipes

### Component A: Floating Glass Island / Pill (Search, Navigation, Action Bar)
```css
.liquid-glass-pill {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 8px 18px;
    border-radius: 9999px;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.02) 100%);
    -webkit-backdrop-filter: blur(32px) saturate(210%);
    backdrop-filter: blur(32px) saturate(210%);
    box-shadow: 
        inset 0 1px 1px 0 rgba(255, 255, 255, 0.32),
        inset 0 0 0 1px rgba(255, 255, 255, 0.06),
        0 8px 24px -4px rgba(0, 0, 0, 0.4);
    border: none;
    color: #fff;
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.liquid-glass-pill:hover {
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.13) 0%, rgba(255, 255, 255, 0.04) 100%);
    box-shadow: 
        inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.48),
        inset 0 0 0 1px rgba(255, 255, 255, 0.12),
        0 12px 30px -4px rgba(0, 0, 0, 0.5);
    transform: translateY(-1px);
}
```

### Component B: Floating Glass Card / Sheet (Player Controls, Queue, Dialogs)
```css
.liquid-glass-card {
    position: relative;
    border-radius: 24px;
    background: linear-gradient(165deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.015) 100%);
    -webkit-backdrop-filter: blur(40px) saturate(200%);
    backdrop-filter: blur(40px) saturate(200%);
    box-shadow: 
        inset 0 1px 1px 0 rgba(255, 255, 255, 0.28),
        inset 0 0 0 1px rgba(255, 255, 255, 0.05),
        0 20px 48px -8px rgba(0, 0, 0, 0.55);
    border: none;
    overflow: hidden;
}
```

### Component C: Circular Action Glass Button (Play/Pause, Like, Actions)
```css
.liquid-glass-btn {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.03) 100%);
    -webkit-backdrop-filter: blur(24px) saturate(190%);
    backdrop-filter: blur(24px) saturate(190%);
    box-shadow: 
        inset 0 1px 1px 0 rgba(255, 255, 255, 0.4),
        inset 0 0 0 1px rgba(255, 255, 255, 0.08),
        0 8px 20px -2px rgba(0, 0, 0, 0.35);
    border: none;
    cursor: pointer;
    color: #fff;
    transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.liquid-glass-btn:hover {
    transform: scale(1.08);
    background: linear-gradient(135deg, rgba(255, 255, 255, 0.18) 0%, rgba(255, 255, 255, 0.06) 100%);
    box-shadow: 
        inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.55),
        0 12px 28px -2px rgba(0, 0, 0, 0.45);
}
.liquid-glass-btn:active {
    transform: scale(0.95);
}
```
