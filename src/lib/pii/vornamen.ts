/**
 * Vornamen-Wörterbuch für die Dritte-Personen-Erkennung (N1+, PRESIDIO-
 * ANONYMISIERUNG-BLUEPRINT). Kuratiert statt heruntergeladen: ~750 im
 * DACH-Geschäftsumfeld häufige Vornamen (deutsch klassisch + modern +
 * verbreitete türkische/slawische/arabische/romanische Namen). Die
 * Namensverteilung ist stark kopflastig — diese Liste deckt den weit
 * überwiegenden Teil realer Nennungen ab; der Long Tail bleibt bewusst
 * dem späteren zweiten Netz (NER) überlassen.
 *
 * WICHTIG: Nur Namen aufnehmen, die als großgeschriebenes Einzelwort kaum
 * mit deutschen Substantiven/Wörtern kollidieren. Bekannte Kollisionen
 * (Ernst, Mai, Heide, Rose, März …) stehen in AMBIGUOUS_FIRSTNAMES und
 * werden nur im Kontext »Vorname + Nachname« oder nach Anrede gewertet.
 */

export const FIRST_NAMES: readonly string[] = [
  // ── Deutsch klassisch (m) ──
  'Alexander', 'Andreas', 'Armin', 'Arnold', 'Axel', 'Bernd', 'Bernhard', 'Bodo',
  'Carsten', 'Christian', 'Christoph', 'Clemens', 'Daniel', 'Detlef', 'Dieter',
  'Dietmar', 'Dirk', 'Eckhard', 'Edgar', 'Eduard', 'Egon', 'Emil', 'Erhard',
  'Erich', 'Erwin', 'Eugen', 'Fabian', 'Falk', 'Felix', 'Ferdinand', 'Florian',
  'Frank', 'Franz', 'Friedrich', 'Fritz', 'Georg', 'Gerald', 'Gerd', 'Gerhard',
  'Gernot', 'Gottfried', 'Gregor', 'Guido', 'Gunnar', 'Gunter', 'Günter',
  'Günther', 'Gustav', 'Hagen', 'Hannes', 'Hans', 'Harald', 'Hartmut', 'Heiko',
  'Heiner', 'Heinrich', 'Heinz', 'Helge', 'Helmut', 'Henning', 'Henrik',
  'Herbert', 'Hermann', 'Holger', 'Horst', 'Hubert', 'Hugo', 'Ingo', 'Jakob',
  'Jan', 'Jens', 'Joachim', 'Jochen', 'Johann', 'Johannes', 'Jonas', 'Jörg',
  'Jörn', 'Josef', 'Jürgen', 'Kai', 'Karl', 'Karsten', 'Kaspar', 'Klaus',
  'Konrad', 'Konstantin', 'Kurt', 'Lars', 'Leo', 'Leon', 'Leonhard', 'Lorenz',
  'Lothar', 'Ludwig', 'Lukas', 'Lutz', 'Manfred', 'Marcel', 'Marco', 'Marcus',
  'Mario', 'Mark', 'Marko', 'Markus', 'Martin', 'Marvin', 'Mathias', 'Matthias',
  'Max', 'Maximilian', 'Michael', 'Moritz', 'Nick', 'Niclas', 'Nico', 'Nicolas',
  'Niels', 'Niklas', 'Nils', 'Norbert', 'Olaf', 'Oliver', 'Oskar', 'Oswald',
  'Otto', 'Pascal', 'Patrick', 'Paul', 'Peter', 'Philipp', 'Rainer', 'Ralf',
  'Ralph', 'Raphael', 'Reiner', 'Reinhard', 'Reinhold', 'René', 'Richard',
  'Robert', 'Roland', 'Rolf', 'Roman', 'Ronald', 'Rudolf', 'Rüdiger', 'Rupert',
  'Sebastian', 'Siegfried', 'Simon', 'Stefan', 'Steffen', 'Stephan', 'Sven',
  'Theodor', 'Thilo', 'Thomas', 'Thorsten', 'Tim', 'Timo', 'Tobias', 'Tom',
  'Torben', 'Torsten', 'Udo', 'Ulf', 'Ulrich', 'Uwe', 'Valentin', 'Viktor',
  'Vincent', 'Volker', 'Walter', 'Werner', 'Wilfried', 'Wilhelm', 'Willi',
  'Wolf', 'Wolfgang', 'Wolfram',
  // ── Deutsch klassisch (w) ──
  'Angelika', 'Anette', 'Angela', 'Anja', 'Anke', 'Anna', 'Annegret', 'Annelie',
  'Annette', 'Anni', 'Antje', 'Astrid', 'Barbara', 'Bärbel', 'Beate', 'Bettina',
  'Birgit', 'Birte', 'Brigitte', 'Britta', 'Carina', 'Carla', 'Carmen', 'Carola',
  'Christa', 'Christel', 'Christiane', 'Christina', 'Christine', 'Claudia',
  'Cordula', 'Corinna', 'Cornelia', 'Dagmar', 'Daniela', 'Diana', 'Doris',
  'Dorothea', 'Dörte', 'Edith', 'Elena', 'Elfriede', 'Elisabeth', 'Elke', 'Ella',
  'Ellen', 'Elsa', 'Emilia', 'Emma', 'Erna', 'Esther', 'Eva', 'Franziska',
  'Frauke', 'Frieda', 'Gabi', 'Gabriele', 'Gerda', 'Gertrud', 'Gisela', 'Greta',
  'Gudrun', 'Hanna', 'Hannah', 'Hannelore', 'Hedwig', 'Heike', 'Helena', 'Helene',
  'Helga', 'Henrike', 'Hertha', 'Hilde', 'Hildegard', 'Ilona', 'Ilse', 'Ines',
  'Inga', 'Inge', 'Ingeborg', 'Ingrid', 'Irene', 'Iris', 'Irmgard', 'Isabel',
  'Isabell', 'Isabella', 'Isabelle', 'Jana', 'Janina', 'Janine', 'Jasmin',
  'Jennifer', 'Jessica', 'Johanna', 'Julia', 'Juliane', 'Jutta', 'Karin', 'Karla',
  'Karola', 'Katarina', 'Katharina', 'Kathrin', 'Katja', 'Katrin', 'Kerstin',
  'Kirsten', 'Klara', 'Kristin', 'Kristina', 'Lara', 'Laura', 'Lea', 'Lena',
  'Leonie', 'Liane', 'Lieselotte', 'Lilli', 'Lina', 'Linda', 'Lisa', 'Lisbeth',
  'Lotte', 'Luise', 'Madeleine', 'Magdalena', 'Maike', 'Manuela', 'Mareike',
  'Margarete', 'Margit', 'Margot', 'Maria', 'Marianne', 'Marie', 'Marina',
  'Marlene', 'Marlies', 'Martina', 'Melanie', 'Meike', 'Michaela', 'Miriam',
  'Mona', 'Monika', 'Nadine', 'Nadja', 'Natalie', 'Nicole', 'Nina', 'Nora',
  'Paula', 'Petra', 'Pia', 'Ramona', 'Rebecca', 'Regina', 'Renate', 'Rita',
  'Romy', 'Rosemarie', 'Ruth', 'Sabine', 'Sabrina', 'Sandra', 'Sara', 'Sarah',
  'Saskia', 'Sibylle', 'Sigrid', 'Silke', 'Silvia', 'Simone', 'Sonja', 'Sophia',
  'Sophie', 'Stefanie', 'Steffi', 'Stephanie', 'Susanne', 'Svenja', 'Sylvia',
  'Tanja', 'Tatjana', 'Thea', 'Theresa', 'Traudel', 'Ulrike', 'Ursula', 'Ute',
  'Vanessa', 'Vera', 'Verena', 'Veronika', 'Viktoria', 'Waltraud', 'Wiebke',
  'Yvonne',
  // ── Modern / international (beide) ──
  'Aaron', 'Adam', 'Adrian', 'Adriana', 'Alba', 'Albert', 'Alena', 'Alessandro',
  'Alessia', 'Alex', 'Alexandra', 'Alina', 'Alice', 'Alicia', 'Amelie', 'Amira',
  'Andrea', 'André', 'Angelo', 'Anita', 'Anton', 'Antonia', 'Antonio', 'Ariane',
  'Arne', 'Arthur', 'Aurelia', 'Ben', 'Benedikt', 'Benjamin', 'Bianca', 'Bruno',
  'Bryan', 'Camilla', 'Carl', 'Carlos', 'Caroline', 'Celina', 'Celine', 'Chiara',
  'Chris', 'Clara', 'Claire', 'Colin', 'Dana', 'David', 'Dean', 'Denise',
  'Dennis', 'Diego', 'Dominik', 'Dominique', 'Dustin', 'Dylan', 'Elias', 'Elif',
  'Elina', 'Elisa', 'Emily', 'Enrico', 'Eric', 'Erik', 'Fabio', 'Fabienne',
  'Fatih', 'Fernando', 'Filip', 'Finn', 'Fiona', 'Francesca', 'Francesco',
  'Frederik', 'Gabriel', 'Giovanni', 'Giulia', 'Hanne', 'Harry', 'Helen',
  'Henri', 'Henry', 'Ida', 'Igor', 'Ilias', 'Ilka', 'Iman', 'Ismail', 'Ivan',
  'Ivana', 'Jack', 'Jacob', 'James', 'Jamie', 'Janik', 'Jannik', 'Jannis',
  'Jason', 'Jayden', 'Jean', 'Jeremy', 'Jill', 'Jim', 'Joel', 'John', 'Jon',
  'Jonathan', 'Jos', 'José', 'Josephine', 'Joshua', 'Juan', 'Jule', 'Julian',
  'Juliana', 'Julie', 'Julius', 'Justin', 'Kevin', 'Kian', 'Kim', 'Kira',
  'Kilian', 'Kristian', 'Kyra', 'Larissa', 'Laurin', 'Lennard', 'Lennart',
  'Lenny', 'Leona', 'Leonard', 'Leonardo', 'Levi', 'Liam', 'Lilly', 'Lily',
  'Lior', 'Livia', 'Lorena', 'Louis', 'Louisa', 'Luca', 'Lucas', 'Lucia',
  'Luis', 'Luisa', 'Luke', 'Lydia', 'Maja', 'Malte', 'Mara', 'Marek', 'Margarita',
  'Marius', 'Marlon', 'Marta', 'Mateo', 'Mats', 'Matteo', 'Maurice', 'Maya',
  'Melina', 'Melissa', 'Mia', 'Michel', 'Michelle', 'Mika', 'Mila', 'Milan',
  'Mira', 'Morgan', 'Nathalie', 'Nathan', 'Nele', 'Nelly', 'Niko', 'Nikolai',
  'Nikolas', 'Noah', 'Noel', 'Oscar', 'Pablo', 'Paolo', 'Patricia', 'Pedro',
  'Phil', 'Philip', 'Pierre', 'Rafael', 'Raul', 'Rebekka', 'Ricardo', 'Riccardo',
  'Robin', 'Rocco', 'Rosa', 'Ryan', 'Sam', 'Samira', 'Samuel', 'Santiago',
  'Selina', 'Sergio', 'Silas', 'Sina', 'Sofia', 'Sofie', 'Stella', 'Sue',
  'Tamara', 'Teresa', 'Tessa', 'Theo', 'Tiago', 'Til', 'Till', 'Tina', 'Tommy',
  'Toni', 'Tony', 'Tristan', 'Tyler', 'Valentina', 'Valerie', 'Vince', 'Viola',
  'Vivien', 'Vivienne', 'William', 'Xavier', 'Yannick', 'Yannik', 'Zoe',
  // ── Türkisch / arabisch / persisch (in DACH verbreitet) ──
  'Ahmet', 'Ali', 'Aisha', 'Amin', 'Amir', 'Ayla', 'Aylin', 'Ayse', 'Aziz',
  'Baran', 'Berat', 'Berkay', 'Beyza', 'Bilal', 'Burak', 'Büsra', 'Can',
  'Cem', 'Ceren', 'Defne', 'Deniz', 'Derya', 'Dilara', 'Ebru', 'Ecrin', 'Elanur',
  'Emine', 'Emir', 'Emre', 'Enes', 'Eren', 'Esra', 'Fatima', 'Fatma', 'Ferhat',
  'Gül', 'Hakan', 'Halil', 'Hamza', 'Hasan', 'Hatice', 'Hüseyin', 'Ibrahim',
  'Ilayda', 'Irem', 'Kaan', 'Karim', 'Kemal', 'Kerem', 'Leyla', 'Mehmet',
  'Melek', 'Merve', 'Meryem', 'Mert', 'Mesut', 'Mohamed', 'Mohammed', 'Murat',
  'Mustafa', 'Nur', 'Omar', 'Onur', 'Osman', 'Ömer', 'Özge', 'Özlem', 'Rahim',
  'Rana', 'Riad', 'Said', 'Salih', 'Samet', 'Selim', 'Semih', 'Serkan', 'Sevim',
  'Seyma', 'Sibel', 'Sinan', 'Songül', 'Tarik', 'Tolga', 'Tugba', 'Umut',
  'Yasemin', 'Yasin', 'Yasmin', 'Youssef', 'Yunus', 'Yusuf', 'Zeynep',
  // ── Slawisch / osteuropäisch ──
  'Adrianna', 'Agata', 'Agnieszka', 'Aleksandar', 'Aleksander', 'Aleksandra',
  'Anastasia', 'Andrej', 'Andrzej', 'Aneta', 'Bartosz', 'Bogdan', 'Boris',
  'Damian', 'Danuta', 'Darek', 'Daria', 'Dario', 'Dawid', 'Dimitri', 'Dmitri',
  'Dorota', 'Dragan', 'Dusan', 'Edyta', 'Elzbieta', 'Ewa', 'Goran', 'Grzegorz',
  'Halina', 'Iwona', 'Jacek', 'Jadwiga', 'Jarek', 'Jaroslaw', 'Jerzy', 'Joanna',
  'Jozef', 'Justyna', 'Kamil', 'Kamila', 'Karol', 'Karolina', 'Kasia',
  'Katarzyna', 'Kinga', 'Krystyna', 'Krzysztof', 'Leszek', 'Luka', 'Magda',
  'Malgorzata', 'Marcin', 'Marek', 'Mariusz', 'Marta', 'Mateusz', 'Michal',
  'Milena', 'Miroslav', 'Monika', 'Natalia', 'Nemanja', 'Nikola', 'Nina',
  'Oksana', 'Olga', 'Pawel', 'Piotr', 'Przemyslaw', 'Radek', 'Rafal', 'Renata',
  'Roksana', 'Sergej', 'Slawomir', 'Stanislaw', 'Svetlana', 'Sylwia', 'Tadeusz',
  'Tatiana', 'Tomasz', 'Urszula', 'Vladimir', 'Wanda', 'Wojciech', 'Zbigniew',
  'Zofia', 'Zoran',
];

/**
 * Vornamen, die mit deutschen Wörtern/Substantiven kollidieren — sie zählen
 * NUR im starken Kontext (nach Anrede oder als »Vorname Nachname«-Paar),
 * nie als Einzelwort. Sonst wird »Das war ernst gemeint« → Person n.
 */
export const AMBIGUOUS_FIRSTNAMES: ReadonlySet<string> = new Set([
  'Ernst', 'Mai', 'Heide', 'Rose', 'August', 'Björn', 'Wolf', 'Falk', 'Horst',
  'Malte', 'Til', 'Till', 'Kim', 'Jan', 'Can', 'Nur', 'Gül', 'Deniz', 'Morgan',
  'Sue', 'Jule', 'Mark', 'Marta', 'Mira', 'Milan', 'Toni', 'Stella',
]);
