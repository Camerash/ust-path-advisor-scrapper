const fs = require('fs');
const request = require('retry-request');
const queryString = require('querystring');
const sharp = require('sharp');
const gm = require('gm');

const rootDir = "./data";
const imageDir = rootDir + "/images";
const dataDir = rootDir + "/data";
const tempDir = rootDir + "/temp";
const mapManifestUrl = "http://pathadvisor.ust.hk/super_global.js";
const mapManifestPath = tempDir + "/manifest.js";
const mapTileBaseUrl = "http://pathadvisor.ust.hk/map_pixel.php?";
const mapDataBastUrl = "http://pathadvisor.ust.hk/phplib/get_map_data_2.php?";
const tileSize = 200;
const base = "G";
const csvHeader = "x,y,name,type,imageUrl,link,id\n";

var floors = [];

class Scrapper {

  constructor() {
    if(!fs.existsSync(rootDir)) { fs.mkdirSync(rootDir); }
    if(!fs.existsSync(dataDir)) { fs.mkdirSync(dataDir); }
    if(!fs.existsSync(imageDir)) { fs.mkdirSync(imageDir); }
    if(!fs.existsSync(tempDir)) { fs.mkdirSync(tempDir); }
  }

  scrapeMapTiles() {
    this.getMapManifest(() => {
      this.scrapeFloors();
    });
  }

  getMapManifest(callback) {
    console.log("Connecting to path advisor...")
    request(mapManifestUrl).pipe(fs.createWriteStream(mapManifestPath)).on('finish', () => {
      fs.appendFile(mapManifestPath, '\nexports.floorData = floorData;', (err) => {
        if (err) throw err;
        var manifest = require(mapManifestPath);
        floors = manifest.floorData;
        callback();
      });
    })
  }

  scrapeFloors() {
    if(floors[base] != null) {
      this.scrapeFloor(base);
    }
  }

  async scrapeFloor(floorName) {
    console.log(`Scrapping floor ${floorName}`);
    var mapHeight = floors[floorName].mapHeight;
    var mapWidth = floors[floorName].mapWidth;
    var tempFolderPath = this.getTileTempFolderPath(floorName);
    var floorDataString = "";
    if(!fs.existsSync(tempFolderPath)) { fs.mkdirSync(tempFolderPath); }

    for(var x = 0; x <= mapWidth; x += tileSize) {
      for(var y = 0; y <= mapHeight; y += tileSize) {
        console.log(`Scrapping floor:${floorName} x:${x} y:${y}`);
        var req = await request(this.getTileUrl(x, y, floorName));
        await new Promise((resolve, reject) => {
          req.pipe(fs.createWriteStream(this.getTilePath(x, y, floorName)))
          .on('finish', () => resolve())
          .on('error', reject);
        });

        await new Promise((resolve, reject) => {
          request(this.getDataUrl(x, y, floorName), (err, resp, body) => {
            if(err) reject;
            floorDataString += body;
            resolve();
          });
        });
      }
    }
    await this.mergeTiles(floorName);
    console.log("Writing data")
    await this.writeData(floorName, floorDataString);
    console.log(`Scraping floor ${floorName} completed`);
  }
  
  async mergeTiles(floorName) {
      console.log(`Merging floor ${floorName} map tiles`);
      var mapHeight = floors[floorName].mapHeight;
      var mapWidth = floors[floorName].mapWidth;
      var image = gm();
      for(var x = 0; x <= mapWidth; x += tileSize) {
        for(var y = 0; y <= mapHeight; y += tileSize) {
          image.in('-page', `+${x}+${y}`);  // Custom place for each of the images
          image.in(this.getTilePath(x, y, floorName));
        }
      }
      image.mosaic();  // Merges the images as a matrix
      await image.write(`${imageDir}/${floorName}.png`, (err) => {
          if (err) {
            console.log(err);
            return err;
          }
          return;
      });
  }

  async writeData(floorName, floorDataString) {
    floorDataString = floorDataString.replace(/;/g, ",");
    floorDataString = csvHeader + floorDataString;
    await fs.writeFileSync(`${dataDir}/${floorName}.csv`, floorDataString);
  }

  getDataUrl(xCoor, yCoor, floorName) {
    var params = queryString.stringify({ floor: floorName, MapCoorX: xCoor, MapCoorY: yCoor, offsetX: tileSize, offsetY: tileSize });
    return mapDataBastUrl + params;
  }

  getTileUrl(xCoor, yCoor, floorName) {
    var params = queryString.stringify({ x: xCoor, y: yCoor, floor: floorName, level: 1, lineString: '' });
    return mapTileBaseUrl + params;
  }

  getTileTempFolderPath(floorName) {
    return `${tempDir}/${floorName}`;
  }

  getTilePath(xCoor, yCoor, floorName) {
    return `${this.getTileTempFolderPath(floorName)}/${xCoor}-${yCoor}.png`;
  }
}

module.exports = Scrapper;