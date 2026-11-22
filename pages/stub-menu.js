// On Mochi's own pages there is no Mochi menu: features that add menu entries
// when they load (colors.js) find these do-nothing stand-ins instead.
(globalThis.Mochi = globalThis.Mochi || {}).menu = { addView() {}, addItem() {}, addSetting() {} };
Mochi.features = Mochi.features || [];
