// Short, accurate explanations shown when a process is selected.
export const PROCESSES = {
  evaporation: {
    title: 'Evaporation',
    color: '#f4a340',
    summary: 'Liquid water turns into invisible water vapour.',
    text: [
      'Sunlight heats the ocean surface. The fastest-moving water molecules gain enough energy to break free of the liquid and escape into the air as water vapour, an invisible gas.',
      'Warmer water and stronger sunshine mean faster evaporation. Warm air can also hold much more vapour, about 7% more for every 1 °C of warming. Salt stays behind, so the vapour is fresh water.',
    ],
    fact: 'About 86% of the world’s evaporation comes from the oceans.',
    tryIt: 'Raise the temperature or sunlight and watch more vapour rise from the sea.',
  },
  condensation: {
    title: 'Condensation',
    color: '#9aa9c4',
    summary: 'Water vapour cools and forms cloud droplets.',
    text: [
      'Moist air rises, expands and cools. When it cools to its dew point it can no longer hold all its vapour, and the vapour condenses onto tiny particles of dust, salt or smoke called condensation nuclei.',
      'Billions of these droplets, each about 0.01 mm across, make up a cloud. Condensation releases the heat that was absorbed during evaporation.',
    ],
    fact: 'Clouds are liquid droplets or ice crystals, not vapour. Water vapour itself is invisible.',
    tryIt: 'Choose Rainy weather and watch the clouds thicken and darken.',
  },
  precipitation: {
    title: 'Precipitation',
    color: '#4a90d9',
    summary: 'Water falls from clouds as rain or snow.',
    text: [
      'Inside a cloud, droplets collide and merge, and ice crystals grow by taking vapour from nearby droplets. When they become too heavy to stay up, they fall as precipitation.',
      'If the air near the ground is below about 0–1 °C, it reaches the ground as snow. Otherwise it melts on the way down and falls as rain. Mountains force moist air upward, so their windward slopes get extra precipitation.',
    ],
    fact: 'At milder temperatures you can get snow on the peaks and rain in the valleys at the same time, because air cools with altitude.',
    tryIt: 'Pick Rainy, then slowly lower the temperature and watch rain turn to snow, starting from the mountain tops.',
  },
  freezing: {
    title: 'Freezing',
    color: '#7cc8e8',
    summary: 'Liquid water turns into solid ice.',
    text: [
      'When water loses heat and cools to its freezing point, its molecules slow down and lock into a hexagonal crystal held together by hydrogen bonds. Fresh water freezes at 0 °C. Salt lowers the freezing point of seawater to about −1.9 °C.',
      'Ice is about 9% less dense than liquid water, so it floats. Sea ice forms first in shallow, calm water near the coast and spreads outward.',
    ],
    fact: 'Freezing releases heat (334 kJ per kg) into the surroundings.',
    tryIt: 'Drag the temperature below 0 °C to freeze the river, then below −2 °C to grow sea ice.',
  },
  melting: {
    title: 'Melting',
    color: '#e86f6f',
    summary: 'Ice and snow absorb heat and turn back into liquid water.',
    text: [
      'Above 0 °C, ice absorbs heat from the air and sunlight. The energy breaks the hydrogen bonds that hold the crystal together, and the molecules flow freely as liquid water.',
      'Meltwater from mountain snow and glaciers runs into streams and rivers. Many regions rely on this spring snowmelt for their water supply.',
    ],
    fact: 'Melting 1 kg of ice takes 334 kJ, enough energy to heat that same water from 0 °C to about 80 °C.',
    tryIt: 'After some snowfall, raise the temperature and watch the snow line climb the mountain.',
  },
  runoff: {
    title: 'Runoff',
    color: '#3fb6a8',
    summary: 'Water flows downhill over land, back to the ocean.',
    text: [
      'Rain and meltwater that don’t soak into the ground flow downhill under gravity. They gather into streams and rivers that carry the water back to the ocean.',
      'Some water soaks in to become groundwater. Groundwater seeps slowly into rivers and keeps them flowing between storms.',
    ],
    fact: 'When rivers freeze or precipitation is locked up as snow, runoff slows until the thaw.',
    tryIt: 'Make it rain, or melt the snowpack, to make the river run faster.',
  },
}

export const PROCESS_ORDER = ['evaporation', 'condensation', 'precipitation', 'freezing', 'melting', 'runoff']

export const WATER_STATES = {
  solid: {
    title: 'Solid · Ice',
    text: 'Each molecule is held by hydrogen bonds to four neighbours in an open hexagonal lattice. The molecules vibrate in place but cannot move past one another. The open structure makes ice less dense than water, which is why it floats.',
  },
  liquid: {
    title: 'Liquid · Water',
    text: 'Molecules stay close together, but hydrogen bonds constantly break and re-form, so they slide and tumble past each other. That is why water flows and takes the shape of its container.',
  },
  gas: {
    title: 'Gas · Water vapour',
    text: 'Molecules have enough energy to break free of hydrogen bonds entirely. They fly about quickly in straight lines, spread far apart and fill any space available. Vapour is invisible.',
  },
}
