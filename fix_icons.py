import re

with open('ui3/app.js', 'r', encoding='utf-8') as f:
    content = f.read()

# New buildShipIcon function with proper ship silhouettes
new_func = '''function buildShipIcon(type, course, selected) {
  const c   = typeColor(type);
  const sz  = selected ? 28 : 18;
  const rot = course || 0;   // AIS course: 0=North; SVG bow points up already
  const glow = selected
    ? `filter:drop-shadow(0 0 8px ${c}cc) drop-shadow(0 0 3px ${c});`
    : `filter:drop-shadow(0 0 4px ${c}99);`;

  const t = (type || 'Unknown').toLowerCase();
  let hull, detail;

  if (t.includes('tanker')) {
    // Tanker: wide, rounded bow, long hull with cargo tanks
    hull   = `<path d="M12,2 C15.5,3.5 17,6.5 17,9 L17,21 L12,24 L7,21 L7,9 C7,6.5 8.5,3.5 12,2 Z" fill="${c}" fill-opacity="0.88" stroke="${c}" stroke-width="0.6"/>`;
    detail = `<ellipse cx="12" cy="13" rx="3.5" ry="5" fill="${c}" fill-opacity="0.28" stroke="${c}" stroke-width="0.4"/>
              <line x1="12" y1="8.5" x2="12" y2="20" stroke="${c}" stroke-opacity="0.5" stroke-width="0.5"/>`;
  } else if (t.includes('cargo') || t.includes('container')) {
    // Cargo/Container: long hull, visible container stacks on deck
    hull   = `<path d="M12,2 L17,6.5 L17,22 L12,24.5 L7,22 L7,6.5 Z" fill="${c}" fill-opacity="0.88" stroke="${c}" stroke-width="0.6"/>`;
    detail = `<rect x="9.5" y="7.5" width="5" height="4" rx="0.4" fill="${c}" fill-opacity="0.4" stroke="${c}" stroke-width="0.4"/>
              <rect x="9.5" y="13"  width="5" height="4" rx="0.4" fill="${c}" fill-opacity="0.4" stroke="${c}" stroke-width="0.4"/>
              <line x1="7" y1="12" x2="17" y2="12" stroke="${c}" stroke-opacity="0.4" stroke-width="0.4"/>`;
  } else if (t.includes('passenger') || t.includes('cruise') || t.includes('ferry')) {
    // Passenger/Cruise: wide hull with tall superstructure
    hull   = `<path d="M12,2 L17.5,6 L17.5,21.5 L12,24 L6.5,21.5 L6.5,6 Z" fill="${c}" fill-opacity="0.88" stroke="${c}" stroke-width="0.6"/>`;
    detail = `<rect x="9.5" y="6.5" width="5" height="12" rx="1.5" fill="white" fill-opacity="0.2" stroke="${c}" stroke-width="0.4"/>
              <rect x="10.5" y="7.5" width="3" height="5" rx="0.5" fill="white" fill-opacity="0.25"/>`;
  } else if (t.includes('military') || t.includes('warship') || t.includes('law')) {
    // Military: angular, aggressive shape with gun barrel
    hull   = `<path d="M12,1.5 L18,6.5 L17,21 L12,24 L7,21 L6,6.5 Z" fill="${c}" fill-opacity="0.9" stroke="${c}" stroke-width="0.7"/>`;
    detail = `<polygon points="10.5,8 13.5,8 13,14.5 11,14.5" fill="${c}" fill-opacity="0.5" stroke="${c}" stroke-width="0.4"/>
              <line x1="12" y1="2" x2="12" y2="7.5" stroke="${c}" stroke-opacity="0.85" stroke-width="1.1" stroke-linecap="round"/>`;
  } else if (t.includes('fishing')) {
    // Fishing: compact with fishing reel/gear markers
    hull   = `<path d="M12,3 L15.5,8 L15.5,19 L12,21 L8.5,19 L8.5,8 Z" fill="${c}" fill-opacity="0.88" stroke="${c}" stroke-width="0.6"/>`;
    detail = `<circle cx="12" cy="14" r="2.5" fill="${c}" fill-opacity="0.3" stroke="${c}" stroke-width="0.5"/>
              <circle cx="12" cy="9"  r="1"   fill="${c}" fill-opacity="0.65"/>
              <line x1="9.5" y1="6" x2="14.5" y2="6" stroke="${c}" stroke-opacity="0.6" stroke-width="0.7"/>`;
  } else if (t.includes('tug') || t.includes('pilot')) {
    // Tug: short, powerful, chunky silhouette
    hull   = `<path d="M12,4 L16,8.5 L16,20 L12,22 L8,20 L8,8.5 Z" fill="${c}" fill-opacity="0.88" stroke="${c}" stroke-width="0.6"/>`;
    detail = `<rect x="9.5" y="9" width="5" height="6" rx="1.5" fill="${c}" fill-opacity="0.35" stroke="${c}" stroke-width="0.4"/>
              <circle cx="12" cy="16.5" r="1.8" fill="${c}" fill-opacity="0.5" stroke="${c}" stroke-width="0.4"/>`;
  } else if (t.includes('high speed') || t.includes('hsc')) {
    // High Speed Craft: very slim, needle-like
    hull   = `<path d="M12,1.5 L15,5.5 L14.5,20.5 L12,22.5 L9.5,20.5 L9,5.5 Z" fill="${c}" fill-opacity="0.88" stroke="${c}" stroke-width="0.6"/>`;
    detail = `<line x1="9.5" y1="10" x2="14.5" y2="10" stroke="${c}" stroke-opacity="0.5" stroke-width="0.5"/>
              <line x1="10" y1="14" x2="14" y2="14" stroke="${c}" stroke-opacity="0.4" stroke-width="0.4"/>`;
  } else if (t.includes('sar') || t.includes('search') || t.includes('rescue')) {
    // SAR: distinctive with rescue cross
    hull   = `<path d="M12,2.5 L16.5,7 L16.5,20 L12,22 L7.5,20 L7.5,7 Z" fill="${c}" fill-opacity="0.88" stroke="${c}" stroke-width="0.6"/>`;
    detail = `<line x1="9.5" y1="13" x2="14.5" y2="13" stroke="white" stroke-opacity="0.85" stroke-width="1.3" stroke-linecap="round"/>
              <line x1="12" y1="10.5" x2="12" y2="15.5" stroke="white" stroke-opacity="0.85" stroke-width="1.3" stroke-linecap="round"/>`;
  } else {
    // Default / Unknown: generic vessel
    hull   = `<path d="M12,2 L17,7 L17,21 L12,23 L7,21 L7,7 Z" fill="${c}" fill-opacity="0.85" stroke="${c}" stroke-width="0.6"/>`;
    detail = `<circle cx="12" cy="15" r="2" fill="${c}" fill-opacity="0.35" stroke="${c}" stroke-width="0.4"/>
              <line x1="12" y1="5" x2="12" y2="9" stroke="${c}" stroke-opacity="0.6" stroke-width="0.7" stroke-linecap="round"/>`;
  }

  return L.divIcon({
    className: '',
    html: `<div style="width:${sz}px;height:${sz}px;transform:rotate(${rot}deg);${glow};transform-origin:center center">
      <svg viewBox="0 0 24 26" width="${sz}" height="${sz}">
        ${hull}
        ${detail}
        ${selected ? `<circle cx="12" cy="12" r="11" fill="none" stroke="${c}" stroke-width="0.7" stroke-opacity="0.5" stroke-dasharray="3 3"/>` : ''}
      </svg></div>`,
    iconSize: [sz, sz], iconAnchor: [sz / 2, sz / 2],
  });
}'''

# Find and replace the old function using regex
old_pattern = r'function buildShipIcon\(type, course, selected\) \{.*?\n\}'
match = re.search(old_pattern, content, flags=re.DOTALL)
if match:
    print(f"Found old function at {match.start()}-{match.end()}")
    new_content = content[:match.start()] + new_func + content[match.end():]
    with open('ui3/app.js', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("SUCCESS: buildShipIcon replaced with proper ship silhouettes")
    print("Rotation bug fixed: removed -90 degree offset")
else:
    print("ERROR: Pattern not matched, trying broader search...")
    # Find by character position
    start = content.find('function buildShipIcon(type, course, selected)')
    if start == -1:
        print("Function NOT FOUND in file!")
    else:
        # Find closing brace by counting braces
        depth = 0
        end = start
        in_func = False
        for i, ch in enumerate(content[start:], start=start):
            if ch == '{':
                depth += 1
                in_func = True
            elif ch == '}':
                depth -= 1
                if in_func and depth == 0:
                    end = i + 1
                    break
        print(f"Found from {start} to {end}")
        new_content = content[:start] + new_func + content[end:]
        with open('ui3/app.js', 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("SUCCESS: buildShipIcon replaced")
