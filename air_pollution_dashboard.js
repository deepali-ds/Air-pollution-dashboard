// ==========================
// GOOGLE EARTH ENGINE APP: AIR QUALITY DASHBOARD 
// ==========================

// Load administrative boundaries (FAO GAUL)
var COUNTRY_TABLE = ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level0");
var CITY_TABLE = ee.FeatureCollection("FAO/GAUL_SIMPLIFIED_500m/2015/level2");

// Load Sentinel-5P pollutant datasets
var DATASETS = {
  'NO2': ee.ImageCollection('COPERNICUS/S5P/OFFL/L3_NO2').select('NO2_column_number_density'),
  'CO': ee.ImageCollection('COPERNICUS/S5P/OFFL/L3_CO').select('CO_column_number_density'),
  'SO2': ee.ImageCollection('COPERNICUS/S5P/OFFL/L3_SO2').select('SO2_column_number_density'),
  'O3': ee.ImageCollection('COPERNICUS/S5P/OFFL/L3_O3').select('O3_column_number_density'),
  'CH4': ee.ImageCollection('COPERNICUS/S5P/OFFL/L3_CH4').select('CH4_column_volume_mixing_ratio_dry_air'),
  'AOD': ee.ImageCollection('MODIS/006/MCD19A2_GRANULES').select('Optical_Depth_047')
};

// Default color palette
var palette = ['blue', 'green', 'yellow', 'orange', 'red'];

// ==========================
// UI SETUP
// ==========================

var map = ui.Map();
map.setCenter(78.9629, 20.5937, 5); // Center on India
map.style().set('cursor', 'crosshair');

var controlPanel = ui.Panel({style: {width: '350px', padding: '8px'}});
var infoPanel = ui.Panel({style: {height: '100px', padding: '8px'}});
var chartPanel = ui.Panel({style: {height: '300px', padding: '8px'}});

ui.root.clear();
ui.root.add(ui.SplitPanel(controlPanel, map));

controlPanel.add(ui.Label('🌍 Air Quality Dashboard', {fontWeight: 'bold', fontSize: '20px'}));

// ==========================
// UI CONTROLS
// ==========================

var countries = COUNTRY_TABLE.aggregate_array('ADM0_NAME').distinct().getInfo();
countries.sort();

var countrySelect = ui.Select({
  items: countries,
  placeholder: 'Select Country'
});
controlPanel.add(ui.Label('Select Country:'));
controlPanel.add(countrySelect);

var citySelect = ui.Select({items: [], placeholder: 'Select City'});
controlPanel.add(ui.Label('Select City:'));
controlPanel.add(citySelect);

var pollutantSelect = ui.Select({
  items: Object.keys(DATASETS),
  placeholder: 'Select Pollutant'
});
controlPanel.add(ui.Label('Select Pollutant:'));
controlPanel.add(pollutantSelect);

var aggSelect = ui.Select({
  items: ['Monthly', 'Yearly'],
  placeholder: 'Select Aggregation'
});
controlPanel.add(ui.Label('Aggregation:'));
controlPanel.add(aggSelect);

var startDate = ui.Textbox({placeholder: 'Start Date (YYYY-MM-DD)', value: '2021-01-01'});
var endDate = ui.Textbox({placeholder: 'End Date (YYYY-MM-DD)', value: '2021-12-31'});
controlPanel.add(ui.Label('Date Range:'));
controlPanel.add(startDate);
controlPanel.add(endDate);

var runButton = ui.Button({label: 'Generate Map & Chart', style: {stretch: 'horizontal'}});
controlPanel.add(runButton);

controlPanel.add(infoPanel);
controlPanel.add(chartPanel);

// ==========================
// ✅ DYNAMIC CITY LIST (UPDATED)
// ==========================
countrySelect.onChange(function(country) {
  if (!country) return;

  // Fetch cities asynchronously
  CITY_TABLE.filter(ee.Filter.eq('ADM0_NAME', country))
    .aggregate_array('ADM2_NAME')
    .distinct()
    .evaluate(function(cities) {
      if (!cities) {
        citySelect.items().reset([]);
        citySelect.setPlaceholder('No cities found');
        return;
      }

      // Clean and sort
      cities = cities.filter(function(c) { return c && c.length > 0; }).sort();

      // Update dropdown
      citySelect.items().reset(cities);
      citySelect.setPlaceholder('Select City');
    });
});

// ==========================
// FUNCTION: POLLUTANT IMAGE WITH DYNAMIC VIS SCALE
// ==========================
function getPollutantImage(pollutant, start, end, region) {
  var dataset = DATASETS[pollutant]
    .filterDate(start, end)
    .filterBounds(region);

  var img = dataset.mean();

  // Compute 90% stretch (auto scaling)
  var stats = img.reduceRegion({
    reducer: ee.Reducer.percentile([5, 95]),
    geometry: region,
    scale: 10000,
    maxPixels: 1e13
  });

  var min = ee.Number(stats.values().get(0));
  var max = ee.Number(stats.values().get(1));

  return {image: img, vis: {min: min.getInfo(), max: max.getInfo(), palette: palette}};
}

// ==========================
// MAIN RUN LOGIC
// ==========================
runButton.onClick(function() {
  infoPanel.clear();
  chartPanel.clear();

  var country = countrySelect.getValue();
  var city = citySelect.getValue();
  var pollutant = pollutantSelect.getValue();
  var start = startDate.getValue();
  var end = endDate.getValue();

  if (!country || !city || !pollutant) {
    infoPanel.add(ui.Label('⚠️ Please select country, city, and pollutant.', {color: 'red'}));
    return;
  }

  var cityFC = CITY_TABLE.filter(ee.Filter.and(
    ee.Filter.eq('ADM0_NAME', country),
    ee.Filter.eq('ADM2_NAME', city)
  ));
  var region = cityFC.geometry();

  map.layers().reset();
  map.addLayer(cityFC, {color: 'black'}, city + ' Boundary');
  map.centerObject(cityFC, 8);

  var imgData = getPollutantImage(pollutant, start, end, region);
  map.addLayer(imgData.image.clip(region), imgData.vis, pollutant + ' concentration');

  // Time-series chart
  var chartData = DATASETS[pollutant]
    .filterDate(start, end)
    .filterBounds(region)
    .map(function(image) {
      var mean = image.reduceRegion({
        reducer: ee.Reducer.mean(),
        geometry: region,
        scale: 5000,
        maxPixels: 1e13
      }).values().get(0);
      return ee.Feature(null, {
        'date': image.date().format('YYYY-MM-dd'),
        'value': mean
      });
    });

  chartData = chartData.filter(ee.Filter.notNull(['value']));

  var chart = ui.Chart.feature.byFeature(chartData, 'date', 'value')
    .setOptions({
      title: pollutant + ' concentration over time - ' + city,
      hAxis: {title: 'Date'},
      vAxis: {title: 'Concentration'},
      lineWidth: 2,
      pointSize: 3
    });

  chartPanel.add(chart);
  infoPanel.add(ui.Label('✅ Visualization and chart ready for ' + city));
});

// ==========================
// MAP CLICK TOOLTIP
// ==========================
var tooltipLabel = ui.Label('Click on map to see pollutant value', {color: 'blue'});
infoPanel.add(tooltipLabel);

map.onClick(function(coords) {
  var point = ee.Geometry.Point(coords.lon, coords.lat);
  var pollutant = pollutantSelect.getValue();
  if (!pollutant) return;

  var img = DATASETS[pollutant].filterDate(startDate.getValue(), endDate.getValue()).mean();

  img.sample(point, 1000).first().evaluate(function(val) {
    if (val) {
      var key = Object.keys(val)[0];
      tooltipLabel.setValue('Pollutant value: ' + val[key].toFixed(6));
    } else {
      tooltipLabel.setValue('No data for this point.');
    }
  });
});
