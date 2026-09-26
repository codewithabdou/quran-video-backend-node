/**
 * Mapping of reciter IDs (AlQuran Cloud / internal IDs) to EveryAyah folder names.
 */
export const RECITER_EVERYAYAH_MAP = {
    "ar.alafasy": "Alafasy_128kbps",
    "ar.abdulbasitmurattal": "Abdul_Basit_Murattal_192kbps",
    "ar.abdullahbasfar": "Abdullah_Basfar_192kbps",
    "ar.abdurrahmaansudais": "Abdurrahmaan_As-Sudais_192kbps",
    "ar.abdulsamad": "AbdulSamad_64kbps_QuranExplorer.Com",
    "ar.shaatree": "Abu_Bakr_Ash-Shaatree_128kbps",
    "ar.ahmedajamy": "Ahmed_ibn_Ali_al-Ajamy_128kbps_ketaballah.net",
    "ar.hanirifai": "Hani_Rifai_192kbps",
    "ar.husary": "Husary_128kbps",
    "ar.husarymujawwad": "Husary_128kbps_Mujawwad",
    "ar.hudhaify": "Hudhaify_128kbps",
    "ar.ibrahimakhbar": "Ibrahim_Akhdar_32kbps",
    "ar.mahermuaiqly": "MaherAlMuaiqly128kbps",
    "ar.muhammadayyoub": "Muhammad_Ayyoub_128kbps",
    "ar.muhammadjibreel": "Muhammad_Jibreel_128kbps",
    "ar.saoodshuraym": "Saood_ash-Shuraym_128kbps",
    "ar.parhizgar": "Parhizgar_48kbps",
    "ar.aymanswoaid": "Ayman_Sowaid_64kbps"
};

/**
 * Returns the EveryAyah folder name for a given reciter ID.
 * Falls back to reciterId itself if not mapped.
 */
export const getEveryAyahReciterFolder = (reciterId) => {
    return RECITER_EVERYAYAH_MAP[reciterId] || reciterId;
};
