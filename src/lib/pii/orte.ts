/**
 * Städte-Wörterbuch für die Orts-Maskierung (N1+). Kuratiert: deutsche
 * Städte > ~60k Einwohner + österreichische/schweizer Zentren + häufige
 * Wirtschaftsstandorte. Orte werden NUR nach lokativen Präpositionen
 * (in/aus/nach/bei/von …) gewertet — das entschärft Kollisionen wie
 * »beim Essen« oder »in der Halle« strukturell (»Essen«/»Halle« matchen
 * nur direkt hinter der Präposition, nicht hinter Artikeln).
 */

export const CITY_NAMES: readonly string[] = [
  // Deutschland (Großstädte + >60k)
  'Berlin', 'Hamburg', 'München', 'Köln', 'Frankfurt am Main', 'Frankfurt',
  'Stuttgart', 'Düsseldorf', 'Leipzig', 'Dortmund', 'Essen', 'Bremen',
  'Dresden', 'Hannover', 'Nürnberg', 'Duisburg', 'Bochum', 'Wuppertal',
  'Bielefeld', 'Bonn', 'Münster', 'Mannheim', 'Karlsruhe', 'Augsburg',
  'Wiesbaden', 'Mönchengladbach', 'Gelsenkirchen', 'Aachen', 'Braunschweig',
  'Chemnitz', 'Kiel', 'Halle', 'Magdeburg', 'Freiburg', 'Krefeld', 'Mainz',
  'Lübeck', 'Erfurt', 'Oberhausen', 'Rostock', 'Kassel', 'Hagen', 'Potsdam',
  'Saarbrücken', 'Hamm', 'Ludwigshafen', 'Mülheim an der Ruhr', 'Mülheim',
  'Oldenburg', 'Osnabrück', 'Leverkusen', 'Darmstadt', 'Heidelberg',
  'Solingen', 'Herne', 'Neuss', 'Regensburg', 'Paderborn', 'Ingolstadt',
  'Offenbach', 'Fürth', 'Ulm', 'Heilbronn', 'Pforzheim', 'Würzburg',
  'Wolfsburg', 'Göttingen', 'Bottrop', 'Reutlingen', 'Koblenz', 'Erlangen',
  'Bremerhaven', 'Recklinghausen', 'Remscheid', 'Bergisch Gladbach', 'Jena',
  'Trier', 'Moers', 'Salzgitter', 'Siegen', 'Gütersloh', 'Hildesheim',
  'Hanau', 'Kaiserslautern', 'Cottbus', 'Schwerin', 'Witten', 'Gera',
  'Iserlohn', 'Ludwigsburg', 'Esslingen', 'Zwickau', 'Düren', 'Ratingen',
  'Flensburg', 'Lünen', 'Villingen-Schwenningen', 'Marl', 'Konstanz', 'Worms',
  'Velbert', 'Minden', 'Neumünster', 'Dessau', 'Norderstedt', 'Delmenhorst',
  'Bamberg', 'Viersen', 'Marburg', 'Gladbeck', 'Rheine', 'Lüneburg', 'Troisdorf',
  'Wilhelmshaven', 'Dorsten', 'Detmold', 'Bayreuth', 'Arnsberg', 'Castrop-Rauxel',
  'Landshut', 'Brandenburg', 'Lüdenscheid', 'Aschaffenburg', 'Bocholt', 'Celle',
  'Kempten', 'Fulda', 'Aalen', 'Dinslaken', 'Lippstadt', 'Herford', 'Rüsselsheim',
  'Kerpen', 'Weimar', 'Plauen', 'Neuwied', 'Sindelfingen', 'Dormagen', 'Neubrandenburg',
  'Grevenbroich', 'Rosenheim', 'Herten', 'Bergheim', 'Friedrichshafen', 'Schwäbisch Gmünd',
  'Garbsen', 'Offenburg', 'Wesel', 'Hürth', 'Greifswald', 'Unna', 'Stralsund',
  'Langenfeld', 'Göppingen', 'Frechen', 'Euskirchen', 'Hameln', 'Meerbusch',
  'Sankt Augustin', 'Baden-Baden', 'Waiblingen', 'Hattingen', 'Lingen',
  'Bad Homburg', 'Pulheim', 'Schweinfurt', 'Wetzlar', 'Passau', 'Nordhorn',
  'Ahlen', 'Kleve', 'Frankfurt an der Oder', 'Gummersbach', 'Ibbenbüren',
  'Böblingen', 'Ravensburg', 'Goslar', 'Peine', 'Emden', 'Cuxhaven', 'Erftstadt',
  'Bergkamen', 'Rastatt', 'Gießen', 'Tübingen', 'Speyer', 'Görlitz', 'Elmshorn',
  'Hilden', 'Leonberg', 'Bad Salzuflen', 'Langenhagen', 'Bad Oeynhausen',
  'Eschweiler', 'Nettetal', 'Stolberg', 'Hof', 'Fellbach', 'Neu-Ulm', 'Dülmen',
  'Gotha', 'Lörrach', 'Weiden', 'Bruchsal', 'Kaufbeuren', 'Memmingen',
  // Österreich
  'Wien', 'Graz', 'Linz', 'Salzburg', 'Innsbruck', 'Klagenfurt', 'Villach',
  'Wels', 'Sankt Pölten', 'Dornbirn', 'Steyr', 'Feldkirch', 'Bregenz',
  // Schweiz
  'Zürich', 'Genf', 'Basel', 'Bern', 'Lausanne', 'Winterthur', 'Luzern',
  'Sankt Gallen', 'St. Gallen', 'Lugano', 'Biel', 'Thun', 'Zug', 'Schaffhausen',
];

/** Lokative Präpositionen, hinter denen ein Stadtname als Ort gewertet wird. */
export const CITY_PREPOSITIONS: readonly string[] = [
  'in', 'aus', 'nach', 'bei', 'von', 'um', 'über', 'ab', 'per', 'via',
  'Richtung', 'Standort', 'Werk', 'Filiale', 'Niederlassung', 'Büro',
];
