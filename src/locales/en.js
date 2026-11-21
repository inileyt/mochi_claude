/*
 * Mochi — English texts. The key is what the code asks for; the value is
 * what people see. A value can be a list: Mochi picks one line at random.
 * {name} is filled in by the code. To add a language, copy this file
 * (see CONTRIBUTING.md).
 */
(() => {
  const Mochi = (globalThis.Mochi = globalThis.Mochi || {});
  Mochi.locales = Mochi.locales || {};
  Mochi.locales.en = {
    'language.name': 'English',

    // menu sections
    'section.mochi': 'Mochi',
    'section.wardrobe': 'Wardrobe',
    'section.friends': 'Friends',
    'section.tools': 'Tools',
    'section.settings': 'Settings',
    'section.empty': 'Nothing here yet. Mochi is working on it!',

    // Mochi section
    'menu.scan': 'Scan this UI',
    'menu.pick': 'Pick an element',
    'menu.pocket': 'Pocket',
    'menu.play': 'Play',

    // Wardrobe
    'outfit.santa-hat': 'Santa hat',
    'outfit.scarf': 'Scarf',
    'outfit.bow': 'Bow',
    'outfit.sunglasses': 'Sunglasses',
    'outfit.headphones': 'Headphones',
    'outfit.wizard-hat': 'Wizard hat',
    'wardrobe.level': 'Lv {level}',
    'wardrobe.locked': 'Unlocks at level {level}',
    'wardrobe.lockedSay': 'Not yet! Level {level}',
    'wardrobe.wearSay': ['Looking good!', 'Ooh, fancy!', 'Do I look cute?', 'Stylish!'],
    'wardrobe.takeOff': 'Take everything off',
    'wardrobe.seasonOn': '❄ Winter outfit is on (Dec 15 – Jan 7)',

    // Levels, XP, streak
    'stats.level': 'Level {level}',
    'stats.streak': '🔥 {n}-day streak',
    'stats.best': 'Best streak: {n} days',
    'stats.xp': 'Experience',
    'stats.next': 'Next: {what} at Lv {level}',
    'stats.share': '⤓ Share card',
    'stats.shared': 'Saved! Show me off ♥',
    'level.up': 'Level {level}!',
    'level.unlocked': 'Unlocked: {what}!',
    'streak.first': 'Day 1 together! Hi!',
    'streak.day': 'Day {n} together!',
    'streak.missed': 'I missed you…',
    'streak.again': 'Day 1 again, let’s go!',
    'share.level': 'Level {level}',
    'share.streak': '🔥 {n}-day streak',
    'share.tagline': 'my tiny pixel companion for Claude',
    'idle.yawn': 'Yawning',
    'idle.yawnSay': '*yaaawn*',
    'idle.juggle': 'Juggling a star',
    'idle.read': 'Reading a tiny book',
    'friend.cat': 'Cat friend',
    'friend.robot': 'Robot friend',
    'friend.ghost': 'Ghost friend',

    // Friends & characters
    'friends.me': 'Who am I',
    'friends.beside': 'Friend beside me',
    'friends.none': 'Nobody',
    'friends.note': 'Friends unlock with levels: cat 3, robot 6, ghost 10.',
    'char.mochi.name': 'Mochi',
    'char.cat.name': 'Cat',
    'char.cat.hello': ['Mrrp.', 'Oh. Hi.', 'Meow?'],
    'char.cat.poke': ['Mrrow!', 'Purr…', '*stretches*', 'Hmph.'],
    'char.cat.happy': ['Purr.', 'Acceptable.', 'Mrrp!'],
    'char.cat.idle': ['*licks paw*', 'Purr…', '…'],
    'char.cat.sleepy': ['Nap time.', 'zzz…'],
    'char.cat.wake': ['*big stretch*', 'Mrrp?'],
    'char.cat.thinking': ['Hmm. Nap first.', '…'],
    'char.cat.oops': ['Oops.', 'It was like that.', '*knocks it over*'],
    'char.robot.name': 'Robot',
    'char.robot.hello': ['Beep! Hello, human.', 'BOOT COMPLETE.', 'Boop!'],
    'char.robot.poke': ['Beep!', 'Boop.', 'Ticklish circuits!'],
    'char.robot.happy': ['Task complete.', 'Beep boop!', '100% done.'],
    'char.robot.thinking': ['Processing…', 'Computing…'],
    'char.robot.curious': ['Input received.', 'Analyzing…'],
    'char.robot.excited': ['BEEP BEEP!', 'Overclocking!'],
    'char.robot.idle': ['01001000 01101001', 'Beep.', '*whirr*'],
    'char.robot.code': ['BEEP BOOP! CODE!', 'Code detected! ♥', 'Compiling joy…'],
    'char.ghost.name': 'Ghost',
    'char.ghost.hello': ['…hi', 'oh! hello…', '*waves shyly*'],
    'char.ghost.poke': ['eep!', '*fades*', 'oooh…'],
    'char.ghost.happy': ['yay… ♥', 'nice…'],
    'char.ghost.idle': ['ooOOoo…', '*floats*'],
    'char.ghost.surprised': ['BOO!', 'eek!'],
    'char.ghost.sad': ['*hugs*', 'it’s ok…'],
    'char.ghost.boo': ['BOO!', 'OooOOooo!', '*spooky*'],

    // Prompt coach (tips)
    'coach.tip.vague': 'What should it fix, and how? Tell Claude a bit more?',
    'coach.tip.short': 'A little more detail helps Claude!',
    'coach.tip.error': 'Paste the error message too?',
    'coach.tip.code': 'Paste the code too?',
    'coach.tip.reference': 'What’s “it”? Claude can’t see it yet.',
    'coach.tip.goal': 'Tell Claude what it’s for, or who it’s for?',

    // Long-chat warning
    'longChat.title': 'This chat is getting long',
    'longChat.say': 'This chat is getting long… *yawn* Long chats get slow and use up your limits faster. Want a prompt that asks Claude for a summary, to carry on in a new chat?',
    'longChat.copy': 'Copy summary prompt',
    'longChat.notNow': 'Not now',
    'longChat.copied': 'Copied! Paste it here, then start a new chat with the summary.',
    'longChat.copyFailed': 'Hmm, I couldn’t copy it this time.',
    'longChat.later': 'Okay! I’ll keep going.',
    'longChat.tiredSay': ['*yawn* Long chat…', 'So many words… *yawn*', 'My eyes are heavy…'],
    'longChat.prompt': 'Please write a short summary of our conversation so far, so I can continue in a new chat. Include: the goal, the key facts and decisions, the final versions of any code or text we settled on, and the open questions or next steps. Keep it compact and self-contained.',

    // Settings
    'settings.language': 'Language',
    'settings.language.auto': 'Auto (browser)',
    'settings.idleAntics': 'Idle antics',
    'settings.seasonal': 'Seasonal outfit & snow',
    'settings.progress': 'Levels, XP & streak',
    'settings.friends': 'Friends',
    'settings.sound': '8-bit sounds',
    'settings.volume': 'Volume',
    'settings.coach': 'Prompt tips',
    'settings.longChat': 'Long-chat warning',
    'settings.resetPosition': 'Back to my spot',
    'settings.close': 'Close',
  };
})();
