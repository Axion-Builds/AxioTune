# AxioTune Project Rules & Standards

## 1. Web Typography Guidelines & Mandatory Skill
- Whenever tasked with improving, modifying, or reviewing fonts, typography, text styling, or reading comfort, **ALWAYS** activate and adhere to the `web-typography` skill (`~/.gemini/config/skills/web-typography/SKILL.md`).
- **Zero Guesswork / Random Swapping**: Never introduce unvetted display fonts or arbitrary font pairings without scoring against the 10-point diagnostic rubric in `web-typography`.
- **Rhythm & Hierarchy**: Ensure clear scale ratio between hierarchy levels. Body text measure must stay within 45–75 characters (ideal 65ch) with 1.4–1.7 line-height. Headings should be tighter (1.1–1.25).
- **Font Selection**: Default to proven web typography pairings (e.g. Outfit / Inter / system stacks) unless explicitly instructed otherwise with user approval.

## 2. AxioTune Architecture Constraints
- **Preserve Canvas Transparency on `#player-screen`**:
  `#player-screen` must strictly remain `background: transparent;` without blur filters or solid overlays. The dynamic WebGL fluid shader (`#webgl-canvas` via `kawarp.js`) renders behind it. Any opaque background or heavy filter ruins the ambient visual experience.
- **Git Execution**:
  Git executable path on this system: `C:\Users\Adarsh shukla\AppData\Local\GitHubDesktop\app-3.6.3\resources\app\git\cmd\git.exe`.
- **Production Verification**:
  Always verify responsive layout and console errors before and after any change. Render deploy cycle takes 2-3 minutes.


## 3. Liquid Glass Design System (BitChord / Apple Music / Haze Standard)
- **Mandatory Reference**: Whenever the user asks for "liquid glass", "frosted glass", or glassmorphism, **ALWAYS** inspect and use `docs/LIQUID_GLASS_SPEC.md`.
- **Zero Cheap Wireframe Borders**: Never use flat `1px solid rgba(255,255,255,0.2)` or solid gray lines. Always use a dual-inset optical meniscus highlight (`inset 0 1px 1px 0 rgba(255,255,255,0.35)` + subtle ambient shadow).
- **Zero Cut-off Lines**: Header or sheet blurs must extend progressively with linear gradient masks (`-webkit-mask-image: linear-gradient(to bottom, #000 0%, #000 55%, transparent 100%)`) without hard bottom boundaries.
- **Vivid Chromatic Saturation**: Backdrop filters must combine high saturation (`saturate(200% - 240%)`) with ultra-translucent gradients (`rgba(255,255,255,0.08)` to `0.02`), letting background WebGL colors shine through with high vibrancy.
