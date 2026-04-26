// Procedural pixel-art sprites painted to offscreen canvases.
// Each sprite is defined as a string array + a palette map.
window.RR = window.RR || {};

RR.Sprites = (function () {
  function makeSprite(rows, palette) {
    const h = rows.length;
    const w = rows[0].length;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < w; x++) {
        const ch = row[x];
        const col = palette[ch];
        const i = (y * w + x) * 4;
        if (!col) {
          img.data[i + 3] = 0;
        } else {
          img.data[i] = col[0];
          img.data[i + 1] = col[1];
          img.data[i + 2] = col[2];
          img.data[i + 3] = 255;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  function draw(ctx, sprite, x, y) {
    ctx.drawImage(sprite, x, y);
  }

  // Player car — 16x24, top-down. Rectangular sports car: white body with
  // dual pink racing stripes through the door panels, rounded bumper corners
  // bowing out front and rear, side indents at the doors with wheels tucked
  // into the indent, dark windshields front and rear.
  // '#' body, 'o' body outline (rounded corner), 'd' windshield,
  // 'D' wheel, 'P' racing stripe, '.' transparent.
  const PLAYER = makeSprite([
    '................',
    '....oo####oo....',
    '...o########o...',
    '..o##########o..',
    '..############..',
    '..#dddddddddd#..',
    '..#dddddddddd#..',
    '..#dddddddddd#..',
    '..D##########D..',
    '..D##########D..',
    '...#PP####PP#...',
    '...#PP####PP#...',
    '...#PP####PP#...',
    '...#PP####PP#...',
    '..D##########D..',
    '..D##########D..',
    '..#dddddddddd#..',
    '..#dddddddddd#..',
    '..############..',
    '..############..',
    '..o##########o..',
    '...o########o...',
    '....oo####oo....',
    '................',
  ], {
    '#': [238, 238, 240],   // body white
    'o': [120, 120, 130],   // rounded-corner shadow
    'd': [40,  44,  60],    // windshield dark
    'D': [22,  22,  22],    // wheel
    'P': [220, 60,  130],   // racing stripe pink
    '.': null,
  });

  // Generic NPC sedan template — 16x24, slightly boxier than the player car,
  // body color parameterized so we can recolor for visual variety.
  const NPC_TEMPLATE = [
    '................',
    '....########....',
    '...##########...',
    '..############..',
    '..#bbbbbbbbbb#..',
    '..#dddddddddd#..',
    '..#dddddddddd#..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..############..',
    '..#dddddddddd#..',
    '..#dddddddddd#..',
    '..#bbbbbbbbbb#..',
    '..############..',
    '..############..',
    '...##########...',
    '....########....',
    '................',
  ];

  function darken(rgb, amount) {
    const a = amount == null ? 0.55 : amount;
    return [(rgb[0] * a) | 0, (rgb[1] * a) | 0, (rgb[2] * a) | 0];
  }

  function makeNpcSprite(body) {
    return makeSprite(NPC_TEMPLATE, {
      '#': body,
      'b': darken(body),
      'd': [40, 44, 60],
      '.': null,
    });
  }

  const NPC_VARIANTS = [
    makeNpcSprite([60,  110, 200]),  // blue sedan
    makeNpcSprite([60,  160, 80]),   // green sedan
    makeNpcSprite([240, 200, 60]),   // yellow taxi
    makeNpcSprite([220, 130, 50]),   // orange
    makeNpcSprite([150, 80,  180]),  // purple
    makeNpcSprite([200, 200, 210]),  // silver
  ];

  // Road-rage tinted player car — same shape, red wash overlaid via source-atop.
  function tinted(srcCanvas, rgba) {
    const c = document.createElement('canvas');
    c.width = srcCanvas.width;
    c.height = srcCanvas.height;
    const ctx2 = c.getContext('2d');
    ctx2.drawImage(srcCanvas, 0, 0);
    ctx2.globalCompositeOperation = 'source-atop';
    ctx2.fillStyle = rgba;
    ctx2.fillRect(0, 0, c.width, c.height);
    return c;
  }
  const PLAYER_RAGING = tinted(PLAYER, 'rgba(230, 50, 50, 0.55)');

  // ---- Pickup sprites: 14x14 each, drawn on the road. ----
  // Coffee — brown cup, white lid, steam wisps. 'c' cup, 'l' lid, 's' steam, 'h' handle.
  const PU_COFFEE = makeSprite([
    '..............',
    '....s..s..s...',
    '...s..s..s....',
    '..llllllllll..',
    '..llllllllll..',
    '..cccccccccc.h',
    '..cccccccccchh',
    '..cccccccccchh',
    '..cccccccccc.h',
    '..cccccccccc..',
    '..cccccccccc..',
    '...cccccccc...',
    '....cccccc....',
    '..............',
  ], {
    'c': [120, 70, 30],
    'l': [240, 240, 240],
    's': [200, 200, 220],
    'h': [120, 70, 30],
    '.': null,
  });

  // Jump — upward arrow on a tile.
  const PU_JUMP = makeSprite([
    '..............',
    '..jjjjjjjjjj..',
    '..j........j..',
    '..j...AA...j..',
    '..j..AAAA..j..',
    '..j.AAAAAA.j..',
    '..jAAAAAAAAj..',
    '..j...AA...j..',
    '..j...AA...j..',
    '..j...AA...j..',
    '..j...AA...j..',
    '..j........j..',
    '..jjjjjjjjjj..',
    '..............',
  ], {
    'j': [60, 200, 240],
    'A': [240, 240, 240],
    '.': null,
  });

  // Shortcut — lightning bolt on a tile.
  const PU_SHORTCUT = makeSprite([
    '..............',
    '..ssssssssss..',
    '..s........s..',
    '..s....BB..s..',
    '..s...BB...s..',
    '..s..BB....s..',
    '..s.BBBBBB.s..',
    '..s....BB..s..',
    '..s...BB...s..',
    '..s..BB....s..',
    '..s.BB.....s..',
    '..s........s..',
    '..ssssssssss..',
    '..............',
  ], {
    's': [240, 200, 60],
    'B': [60, 40, 20],
    '.': null,
  });

  // Lo-fi — musical note / vinyl on a tile.
  const PU_LOFI = makeSprite([
    '..............',
    '..LLLLLLLLLL..',
    '..L........L..',
    '..L..NNNNN.L..',
    '..L..N...N.L..',
    '..L..N...N.L..',
    '..L..N...N.L..',
    '..L..N...N.L..',
    '..LNNN.....L..',
    '..LNNN.....L..',
    '..L.NN.....L..',
    '..L........L..',
    '..LLLLLLLLLL..',
    '..............',
  ], {
    'L': [180, 90, 200],
    'N': [240, 240, 240],
    '.': null,
  });

  const PICKUPS = {
    coffee:   PU_COFFEE,
    jump:     PU_JUMP,
    shortcut: PU_SHORTCUT,
    lofi:     PU_LOFI,
  };

  return { makeSprite, draw, PLAYER, PLAYER_RAGING, NPC_VARIANTS, PICKUPS };
})();
