import { useEffect } from 'react';

const DATA_SOURCES = [
  {
    group: 'a. Numerical Ocean Model Outputs',
    items: [
      {
        name: 'INCOIS Live Access Server (LAS)',
        url: 'https://las.incois.gov.in/',
        note: 'Indian Ocean gridded hydrodynamic and biophysical model outputs (ROMS, MOM, INCOIS-GODAS). Interactive visualization, subsetting, and NetCDF downloads.'
      },
      {
        name: 'Copernicus Marine — GLORYS12V1 Global Physical Reanalysis',
        url: 'https://data.marine.copernicus.eu/product/GLOBAL_MULTIYEAR_PHY_001_030/description',
        note: 'High-resolution (~8.3 km, 1/12° grid) eddy-resolving physical reanalysis with 50 depth levels (0–5728m). Daily means of potential temperature (thetao), salinity (so), and horizontal currents (uo, vo).'
      },
      {
        name: 'INCOIS THREDDS Data Server (TDS / OPeNDAP)',
        url: 'https://tds.incois.gov.in/thredds/catalog.html',
        note: 'Direct OPeNDAP, WMS, and NetCDFSubset catalog for real-time and archived Indian Ocean model forecasts and gridded analyses.'
      },
      {
        name: 'INCOIS Ocean Data and Information System (ODIS)',
        url: 'https://odis.incois.gov.in/',
        note: 'Unified geospatial portal for Indian coastal and open-ocean numerical simulations, wave forecasts, and disaster warnings.'
      }
    ]
  },
  {
    group: 'b. Argo Global Data',
    items: [
      {
        name: 'IFREMER Argo GDAC (FTP Server)',
        url: 'ftp://ftp.ifremer.fr/ifremer/argo',
        note: 'Official Global Data Assembly Centre (GDAC) archive. Contains global core, deep, and BGC-Argo profiles, trajectories, and metadata NetCDF collections.'
      },
      {
        name: 'IFREMER Argo GDAC (HTTPS Web Mirror)',
        url: 'https://data-argo.ifremer.fr/',
        note: 'High-speed HTTPS web mirror of the Argo GDAC. Direct browser and curl/wget access to dac/ (incois/, coriolois/, etc.) and geo/ directory structures.'
      },
      {
        name: 'US GODAE Argo GDAC',
        url: 'https://usgodae.org/argo/argo.html',
        note: 'Monterey US Navy / NOAA Global Data Assembly Centre mirror providing global Argo profiles and real-time synchronizations.'
      },
      {
        name: 'IFREMER Argo — Indian Ocean (Direct NetCDF Geo Archive)',
        url: 'https://data-argo.ifremer.fr/geo/indian_ocean/',
        note: 'Direct geographic directory of Indian Ocean Argo profiles, trajectories, and cycle files organized geographically for rapid regional retrieval.'
      },
      {
        name: 'IFREMER Argo — INCOIS DAC',
        url: 'https://data-argo.ifremer.fr/dac/incois/',
        note: 'National Data Assembly Centre repository holding all Indian National Centre for Ocean Information Services deployed floats.'
      },
      {
        name: 'INCOIS Argo Regional Centre (ARC India)',
        url: 'https://incois.gov.in/argo/argo.jsp',
        note: 'Dedicated Indian Ocean Argo regional data portal featuring floats deployed by India and international partners with specialized quality control.'
      }
    ]
  },
  {
    group: 'c. Underwater Glider Data',
    items: [
      {
        name: 'OceanGliders GDAC v2 (FTP Server)',
        url: 'ftp://ftp.ifremer.fr/ifremer/glider/v2/',
        note: 'International OceanGliders GDAC v2 repository containing quality-controlled autonomous underwater glider transects, dives, and trajectories.'
      },
      {
        name: 'OceanGliders GDAC (HTTPS Web Mirror)',
        url: 'https://data-glider.ifremer.fr/',
        note: 'Direct HTTPS access to OceanGliders GDAC NetCDF files, missions, and deployment trajectories without requiring an FTP client.'
      },
      {
        name: 'OceanGliders Data Portal (GitHub)',
        url: 'https://oceangliders.github.io/data/',
        note: 'Official OceanGliders community data specifications, NetCDF conventions, and global mission discovery resources.'
      },
      {
        name: 'Australian IMOS / AODN Glider Facility (Indian Ocean)',
        url: 'https://portal.aodn.org.au/',
        note: 'Integrated Marine Observing System (IMOS) Slocum and Seaglider missions along Western Australia, Ningaloo Reef, and the Eastern Indian Ocean.'
      },
      {
        name: 'INCOIS Glider Operations (Bay of Bengal)',
        url: 'https://incois.gov.in/portal/datainfo/glider.jsp',
        note: 'Autonomous underwater glider missions conducted by INCOIS in the Bay of Bengal for upper-ocean stratification and cyclone tracking.'
      }
    ]
  },
  {
    group: 'd. Collection of In-Situ Data (Moorings, Buoys, Ship CTD)',
    items: [
      {
        name: 'INCOIS In-Situ Data Holdings',
        url: 'https://incois.gov.in/site/dataholdings.jsp',
        note: 'Comprehensive repository of Indian in-situ ocean observations: drifting buoys, moored buoy networks, XBT/XCTD lines, HF radar, and wave rider buoys.'
      },
      {
        name: 'INCOIS OMNI Moored Buoy Network',
        url: 'https://incois.gov.in/mooredbuoy/buoydata.jsp',
        note: 'Ocean Moored buoy Network for the Northern Indian Ocean (OMNI) delivering real-time surface meteorological and sub-surface oceanographic time series.'
      },
      {
        name: 'OceanSITES Global Reference Stations',
        url: 'http://www.oceansites.org/data/',
        note: 'Worldwide network of long-term deepwater ocean reference stations measuring physical, biogeochemical, and meteorological variables throughout the water column.'
      },
      {
        name: 'NOAA PMEL RAMA Moored Buoy Array',
        url: 'https://www.pmel.noaa.gov/gtmba/pmel-theme/indian-ocean-rama',
        note: 'Research Moored Array for African-Asian-Australian Monsoon Analysis and Prediction (RAMA) in the tropical Indian Ocean.'
      },
      {
        name: 'SEANOE Marine Data Repository',
        url: 'https://www.seanoe.org/',
        note: 'French open-access publisher for marine data with verified DOIs, containing deep-sea moorings (LOCO), glider campaigns, and hydrographic cruises.'
      }
    ]
  },
  {
    group: 'e. Satellite Remote Sensing & Marine Observation Products',
    items: [
      {
        name: 'Copernicus Marine — Global SST L4 Analysis',
        url: 'https://data.marine.copernicus.eu/product/SST_GLO_SST_L4_NRT_OBSERVATIONS_010_001/description',
        note: 'Near-real-time and multi-year gap-free Level-4 Sea Surface Temperature (SST) foundation analysis at 0.05° resolution.'
      },
      {
        name: 'Copernicus Marine — Global Altimetry Sea Level & Currents',
        url: 'https://data.marine.copernicus.eu/product/SEALEVEL_GLO_PHY_L4_NRT_OBSERVATIONS_008_046/description',
        note: 'Multi-satellite merged Sea Level Anomaly (SLA) and absolute surface geostrophic current vectors on a 0.25° regular grid.'
      },
      {
        name: 'ISRO MOSDAC (Ocean Satellite Archive)',
        url: 'https://www.mosdac.gov.in/',
        note: 'Meteorological and Oceanographic Satellite Data Archival Centre hosting Indian satellite missions (Oceansat-2/3, SCATSAT-1, INSAT-3D/3DR).'
      }
    ]
  }
];

export default function DataSourcesModal({ isOpen, onClose }) {
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="source-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="source-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-sources-title"
        data-testid="data-sources-modal"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="source-dialog-header">
          <div>
            <p className="eyebrow">DATA PROVENANCE</p>
            <h2 id="data-sources-title">Dataset directory</h2>
            <p>Official sources to integrate into the SAMUDRA-3D data pipeline.</p>
          </div>
          <button type="button" className="source-dialog-close" onClick={onClose} aria-label="Close dataset directory">
            Close
          </button>
        </header>

        <div className="source-truth">
          <span>Operational Numerical Model</span>
          <p>
            The digital twin renders operational hydrodynamic model fields (ROMS & GLORYS12V1 Indian Ocean domain) calibrated with verified in-situ observational platforms (Argo & Gliders).
          </p>
        </div>

        <div className="bg-slate-950/80 border border-sky-500/40 rounded-lg p-3 mx-4 my-2 text-xs">
          <div className="flex items-center justify-between text-sky-400 font-mono text-[11px] mb-1.5">
            <span className="font-bold flex items-center gap-1.5">
              <span>⚡</span> COPERNICUS MARINE CLI SUBSET (NORTH INDIAN OCEAN)
            </span>
            <span className="text-[10px] text-slate-400">50°E–100°E, 0°N–25°N</span>
          </div>
          <pre className="bg-slate-900/90 text-slate-200 p-2.5 rounded font-mono text-[10.5px] overflow-x-auto leading-relaxed border border-slate-800">
{`copernicusmarine subset \\
  --dataset-id cmems_mod_glo_phy_my_0.083deg_P1D-m \\
  --variable thetao --variable so --variable uo --variable vo \\
  --minimum-longitude 50.0 --maximum-longitude 100.0 \\
  --minimum-latitude 0.0 --maximum-latitude 25.0 \\
  --minimum-depth 0.49 --maximum-depth 100.0 \\
  --start-datetime 2025-01-01 --end-datetime 2026-09-10 \\
  --output-filename indian_ocean_glorys12v1.nc`}
          </pre>
        </div>

        <div className="source-list">
          {DATA_SOURCES.map((section) => (
            <section className="source-section" key={section.group}>
              <h3>{section.group}</h3>
              {section.items.map((source) => (
                <article className="source-card" key={source.url}>
                  <div>
                    <h4>{source.name}</h4>
                    <p>{source.note}</p>
                  </div>
                  <a href={source.url} target="_blank" rel="noreferrer" title={`Open ${source.name}`}>
                    <span>Open source</span>
                    <code>{source.url}</code>
                  </a>
                </article>
              ))}
            </section>
          ))}
        </div>

        <footer className="source-dialog-footer">
          <strong>Before a source is shown on the globe:</strong> validate licence or access, time coverage, coordinates, units,
          depth convention and provider quality-control flags.
        </footer>
      </section>
    </div>
  );
}
