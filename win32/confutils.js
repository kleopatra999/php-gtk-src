// Utils for configure script
/*
  +----------------------------------------------------------------------+
  | PHP-GTK Version 2                                                    |
  +----------------------------------------------------------------------+
  | Copyright (c) 1997-2005 The PHP Group                                |
  +----------------------------------------------------------------------+
  | This source file is subject to version 3.0 of the PHP license,       |
  | that is bundled with this package in the file LICENSE, and is        |
  | available through the world-wide-web at the following url:           |
  | http://www.php.net/license/3_0.txt.                                  |
  | If you did not receive a copy of the PHP license and are unable to   |
  | obtain it through the world-wide-web, please send a note to          |
  | license@php.net so we can mail you a copy immediately.               |
  +----------------------------------------------------------------------+
  | Author: Wez Furlong <wez@thebrainroom.com>                           |
  +----------------------------------------------------------------------+
*/

// $Id: confutils.js,v 1.10 2005-09-22 03:30:33 sfox Exp $

/* set vars */
var STDOUT = WScript.StdOut;
var STDERR = WScript.StdErr;
var WshShell = WScript.CreateObject("WScript.Shell");
var FSO = WScript.CreateObject("Scripting.FileSystemObject");
var MFO = null;
var SYSTEM_DRIVE = WshShell.Environment("Process").Item("SystemDrive");
var PROGRAM_FILES = WshShell.Environment("Process").Item("ProgramFiles");

if (PROGRAM_FILES == null) {
	PROGRAM_FILES = "C:\\Program Files";
}

var CWD = WshShell.CurrentDirectory;

if (typeof(CWD) == "undefined") {
	CWD = FSO.GetParentFolderName(FSO.GetAbsolutePathName("buildconf.bat"));
}

configure_args = new Array();
configure_subst = WScript.CreateObject("Scripting.Dictionary");

configure_hdr = WScript.CreateObject("Scripting.Dictionary");
build_dirs = new Array();

extension_include_code = "";
extension_module_ptrs = "";

/* functions */

function count_generated_files() {

	var dir = FSO.GetFolder("ext/gtk+");
	var count = 0;

	iter = new Enumerator(dir.Files);
	name = "";

	for (; !iter.atEnd(); iter.moveNext()) {
		name = FSO.GetFileName(iter.item());
		if (name.match(new RegExp("gen_"))) {
			count++;
		}
	}
	return count;
}

function generate_source() {

	var count = count_generated_files();

	if (count < 8) {
		if (!FSO.FileExists("win32\\temp.bat")) {
			STDERR.WriteLine("Run buildconf first - the source file generator is missing");
			WScript.Quit(10);
		} else {
			WshShell.Run("win32\\temp", 0);
		}
	}
	return;
}

function check_generation() {

	var count = count_generated_files();

	if (count < 8) {
		STDOUT.WriteLine("Waiting for source files to generate...");
		WScript.Sleep(3500);
		check_generation();
	}
	return;
}

function get_version_numbers() {

	/* pick up the version from main/php_gtk.h */
	var vin = file_get_contents("main\\php_gtk.h");
	var version, version_strings, major, minor, details, release, subversion_strings, extra = "";

	if (vin.match(new RegExp("PHP_GTK_VERSION \"([^\"]+)\""))) {
		version = RegExp.$1;
		version_strings = version.split(".");

		major = version_strings[0];
		minor = version_strings[1];
		details = version_strings[2];

		if (details.indexOf("-") == -1) {
			release = details;
		} else {
			subversion_strings = details.split("-");
			release = subversion_strings[0];
			extra = "-" + subversion_strings[1];
		}
	}

	var vfile = FSO.CreateTextFile("main/php_gtk_version.h", true);
	vfile.WriteLine("/* This file is automatically generated during win32 configuration */");
	vfile.WriteLine("/* Edit php_gtk.h to change the version number */");
	vfile.WriteLine("#define PHP_GTK_MAJOR_VERSION " + major);
	vfile.WriteLine("#define PHP_GTK_MINOR_VERSION " + minor);
	vfile.WriteLine("#define PHP_GTK_RELEASE_VERSION " + release);
	vfile.WriteLine("#define PHP_GTK_EXTRA_VERSION \"" + extra + "\"");

	DEFINE('PHP_GTK_VERSION_STRING', version);
}

function condense_path(path) {

	path = FSO.GetAbsolutePathName(path);

	if (path.substr(0, CWD.length).toLowerCase()
			== CWD.toLowerCase() &&
			(path.charCodeAt(CWD.length) == 92 || path.charCodeAt(CWD.length) == 47)) {
		return path.substr(CWD.length + 1);
	}

	var a = CWD.split("\\");
	var b = path.split("\\");
	var i, j;

	for (i = 0; i < b.length; i++) {
		if (a[i].toLowerCase() == b[i].toLowerCase())
			continue;
		if (i > 0) {
			/* first difference found */
			path = "";
			for (j = 0; j < a.length - i; j++) {
				path += "..\\";
			}
			for (j = i; j < b.length; j++) {
				path += b[j];
				if (j < b.length - 1)
					path += "\\";
			}
			return path;
		}
		/* on a different drive */
		break;
	}

	return path;
}

function ConfigureArg(type, optname, helptext, defval) {

	var opptype = type == "enable" ? "disable" : "without";

	if (defval == "yes" || defval == "yes,shared") {
		this.arg = "--" + opptype + "-" + optname;
		this.imparg = "--" + type + "-" + optname;
	} else {
		this.arg = "--" + type + "-" + optname;
		this.imparg = "--" + opptype + "-" + optname;
	}

	this.optname = optname;
	this.helptext = helptext;
	this.defval = defval;
	this.symval = optname.toUpperCase().replace(new RegExp("-", "g"), "_");
	this.seen = false;
	this.argval = defval;
}

function analyze_arg(argval) {

	var ret = new Array();
	var shared = false;

	if (argval == "shared") {
		shared = true;
		argval = "yes";
	} else if (argval == null) {
		/* nothing */
	} else if (arg_match = argval.match(new RegExp("^shared,(.*)"))) {
		shared = true;
		argval = arg_match[1];
	} else if (arg_match = argval.match(new RegExp("^(.*),shared$"))) {
		shared = true;
		argval = arg_match[1];
	}

	ret[0] = shared;
	ret[1] = argval;
	return ret;
}

function conf_process_args() {

	var i, j;
	var configure_help_mode = false;
	var analyzed = false;
	var nice = "cscript /nologo configure.js ";
	var disable_all = false;

	args = WScript.Arguments;
	for (i = 0; i < args.length; i++) {
		arg = args(i);
		nice += ' "' + arg + '"';
		if (arg == "--help") {
			configure_help_mode = true;
			break;
		}
		if (arg == "--disable-all") {
			disable_all = true;
			continue;
		}

		// If it is --foo=bar, split on the equals sign
		arg = arg.split("=", 2);
		argname = arg[0];
		if (arg.length > 1) {
			argval = arg[1];
		} else {
			argval = null;
		}

		// Find the arg
		found = false;
		for (j = 0; j < configure_args.length; j++) {
			if (argname == configure_args[j].imparg || argname == configure_args[j].arg) {
				found = true;

				arg = configure_args[j];
				arg.seen = true;

				analyzed = analyze_arg(argval);
				shared = analyzed[0];
				argval = analyzed[1];

				if (argname == arg.imparg) {
					/* we matched the implicit, or default arg */
					if (argval == null) {
						argval = arg.defval;
					}
				} else {
					/* we matched the non-default arg */
					if (argval == null) {
						argval = arg.defval == "no" ? "yes" : "no";
					}
				}
				
				arg.argval = argval;
				eval("PHP_GTK_" + arg.symval + " = argval;");
				eval("PHP_GTK_" + arg.symval + "_SHARED = shared;");
				break;
			}
		}
		if (!found) {
			STDERR.WriteLine("Unknown option " + argname)
			STDERR.WriteLine("Please try configure.js --help for a list of valid options");
			WScript.Quit(2);
		}
	}

	if (configure_help_mode) {
		STDOUT.WriteBlankLines(1);
		STDOUT.WriteLine("  There are no PHP-GTK extensions available at present.");
		STDOUT.WriteBlankLines(1);

		// Measure width to pretty-print the output
		max_width = 0;
		for (i = 0; i < configure_args.length; i++) {
			arg = configure_args[i];
			if (arg.arg.length > max_width) {
				max_width = arg.arg.length;
			}
		}

		for (i = 0; i < configure_args.length; i++) {
			arg = configure_args[i];

			n = max_width - arg.arg.length;
			pad = "   ";
			for (j = 0; j < n; j++) {
				pad += " ";
			}
			STDOUT.WriteLine("  " + arg.arg + pad + word_wrap_and_indent(max_width + 5, arg.helptext));
		}
		WScript.Quit(1);

	} else { // not --help

		generate_source();
	}

	// Now set any defaults we might have missed out earlier
	for (i = 0; i < configure_args.length; i++) {
		arg = configure_args[i];
		if (arg.seen)
			continue;
		analyzed = analyze_arg(arg.defval);
		shared = analyzed[0];
		argval = analyzed[1];

		if (disable_all) {
			argval = "no";
			shared = false;
		}

		eval("PHP_GTK_" + arg.symval + " = argval;");
		eval("PHP_GTK_" + arg.symval + "_SHARED = shared;");
	}

	MFO = FSO.CreateTextFile("Makefile.objects", true);

	STDOUT.WriteBlankLines(1);
	STDOUT.WriteLine("Saving configure options to configure.bat");
	var nicefile = FSO.CreateTextFile("configure.bat", true);
	nicefile.WriteLine(nice);
	nicefile.Close();

	AC_DEFINE('CONFIGURE_COMMAND', nice);
}

function find_pattern_in_path(pattern, path) {

	if (path == null) {
		return false;
	}

	var dirs = path.split(';');
	var i;
	var items;

	for (i = 0; i < dirs.length; i++) {
		items = glob(dirs[i] + "\\" + pattern);
		if (items) {
			return condense_path(items[0]);
		}
	}
	return false;
}

function ARG_WITH(optname, helptext, defval) {

	configure_args[configure_args.length] = new ConfigureArg("with", optname, helptext, defval);
}

function ARG_ENABLE(optname, helptext, defval) {

	configure_args[configure_args.length] = new ConfigureArg("enable", optname, helptext, defval);
}

function DEFINE(name, value) {

	if (configure_subst.Exists(name)) {
		configure_subst.Remove(name);
	}
	configure_subst.Add(name, value);
}

function AC_DEFINE(name, value, comment, quote) {

	if (quote == null) {
		quote = true;
	}
	if (quote && typeof(value) == "string") {
		value = '"' + value.replace(new RegExp('(["\\\\])', "g"), '\\$1') + '"';
	} else if (value.length == 0) {
		value = '""';
	}
	var item = new Array(value, comment);
	if (configure_hdr.Exists(name)) {
		var orig_item = configure_hdr.Item(name);
		STDOUT.WriteLine("AC_DEFINE[" + name + "]=" + value + ": is already defined to " + item[0]);
	} else {
		configure_hdr.Add(name, item);
	}
}

function PATH_PROG(progname, additional_paths, symbol) {

	var exe;
	var place;
	var cyg_path = PHP_GTK_CYGWIN + "\\bin;" + PHP_GTK_CYGWIN + "\\usr\\local\\bin";

	exe = progname + ".exe";

	if (additional_paths == null) {
		additional_paths = cyg_path;
	} else {
		additional_paths += ";" + cyg_path;
	}

	place = search_paths(exe, additional_paths, "PATH");

	if (place == true) {
		place = exe;
	} else if (place != false) {

		if (place.lastIndexOf("\\") != place.length - 1) {
			place += "\\";
		}

		place = place + exe;

		if (place.indexOf(" ")) {
			place = '"' + place + '"';
		}
	}

	if (place) {
		if (symbol == null) {
			symbol = progname.toUpperCase();
		}
		DEFINE(symbol, place);
	}
	return place;
}

function CHECK_LIB(libnames, target, path_to_check, common_name) {

	STDOUT.Write("Checking for " + libnames + " ... ");

	if (common_name == null && target != null) {
		common_name = target;
	}

	if (path_to_check == null) {
		path_to_check = "";
	}

	// if they specified a common name for the package that contains
	// the library, tag some useful defaults on to the end of the
	// path to be searched
	if (common_name != null) {
		path_to_check += ";..\\" + common_name + "*";
	}

	// Determine target for build flags
	if (target == null) {
		target = "";
	} else {
		target = "_" + target.toUpperCase().replace(new RegExp("-", "g"), "_");
	}

	// Expand path to include general dirs
	path_to_check += ";" + php_usual_lib_suspects;

	// It is common practice to put libs under one of these dir names
	var subdirs = new Array(PHP_GTK_DEBUG == "yes" ? "Debug" : "Release", "lib", "libs", "libexec");

	// libnames can be ; separated list of accepted library names
	libnames = libnames.split(';');

	var i, j, k, libname;
	var location = false;
	var path = path_to_check.split(';');
	
	for (i = 0; i < libnames.length; i++) {
		libname = libnames[i];

		for (k = 0; k < path.length; k++) {
			location = glob(path[k] + "\\" + libname);
			if (location) {
				location = location[0];
				break;
			}
			for (j = 0; j < subdirs.length; j++) {
				location = glob(path[k] + "\\" + subdirs[j] + "\\" + libname);
				if (location) {
					location = location[0];
					break;
				}
			}
			if (location)
				break;
		}

		if (location) {
			location = condense_path(location);
			var libdir = FSO.GetParentFolderName(location);
			libname = FSO.GetFileName(location);
			ADD_FLAG("LDFLAGS" + target, '/libpath:"' + libdir + '" ');
			ADD_FLAG("LIBS" + target, libname);

			STDOUT.WriteLine(	location);

			return location;
		}

		// Check in their standard lib path
		location = find_pattern_in_path(libname, WshShell.Environment("Process").Item("LIB"));

		if (location) {
			location = condense_path(location);
			libname = FSO.GetFileName(location);
			ADD_FLAG("LIBS" + target, libname);

			STDOUT.WriteLine("	<in LIB path> " + libname);
			return location;
		}
	}

	STDOUT.WriteLine("	<not found>");

	return false;
}

function CHECK_HEADER(header_name, path_to_check) {

	var path = search_paths(header_name, path_to_check, "INCLUDE");

	if (!path) {
		ERROR("Aborting configure process");
	}

	return path;
}

// use this for version checking
function GREP_HEADER(header_name, regex, path_to_check) {

	var c = false;

	if (FSO.FileExists(path_to_check + "\\" + header_name)) {
		c = file_get_contents(path_to_check + "\\" + header_name);
	}

	if (!c) {
		/* look in the include path */

		var p = search_paths(header_name, path_to_check, "INCLUDE");

		if (typeof(p) == "string") {
			c = file_get_contents(p);
		}

		if (!c) {
			return false;
		}
	}

	if (typeof(regex) == "string") {
		regex = new RegExp(regex);
	}

	if (c.match(regex)) {
		/* caller can now use RegExp.$1 etc. to get at patterns */
		return true;
	}
	return false;
}

function CHECK_HEADER_ADD_INCLUDE(header_name, flag_name, path_to_check, use_env, add_dir_part, add_to_flag_only) {

	var dir_part_to_add = "";

	if (use_env == null) {
		use_env = true;
	}

	// if true, add the dir part of the header_name to the include path
	if (add_dir_part == null) {
		add_dir_part = false;
	} else if (add_dir_part) {
		var basename = FSO.GetFileName(header_name);
		dir_part_to_add = "\\" + header_name.substr(0, header_name.length - basename.length - 1);
	}

	if (path_to_check == null) {
		path_to_check = php_usual_include_suspects;
	} else {
		path_to_check += ";" + php_usual_include_suspects;
	}
	
	var p = search_paths(header_name, path_to_check, use_env ? "INCLUDE" : null);
	var have = 0;
	var sym;

	if (typeof(p) == "string") {
		ADD_FLAG(flag_name, '/I "' + p + dir_part_to_add + '" ');
	}

	have = p ? 1 : 0

	sym = header_name.toUpperCase();
	sym = sym.replace(new RegExp("[\\\\/\.-]", "g"), "_");

	if (typeof(add_to_flag_only) == "undefined" &&
			flag_name.match(new RegExp("^CFLAGS_(.*)$"))) {
		add_to_flag_only = true;
	}

	if (typeof(add_to_flag_only) != "undefined") {
		ADD_FLAG(flag_name, "/D HAVE_" + sym + "=" + have);
	} else {
		AC_DEFINE("HAVE_" + sym, have, "have the " + header_name + " header file");
	}

	return p;
}

function EXTENSION(extname, file_list, shared, cflags, dllname, obj_dir) {

	var dllflags = "";
	var dep_libs = "";
	var EXT = extname.toUpperCase().replace(new RegExp("-", "g"), "_");
	var extname_for_printing;

	if (cflags == null) {
		cflags = "";
	}

	if (typeof(obj_dir) == "undefined") {

		extname_for_printing = configure_module_dirname;

	} else {

		extname_for_printing = configure_module_dirname + " (via " + obj_dir + ")";
	}

	STDOUT.WriteLine("Enabling extension " + extname_for_printing + " [shared]");

	cflags = "/D COMPILE_DL_" + EXT + "2 /D " + EXT + "_EXPORTS=1" + cflags;

	MFO.WriteBlankLines(1);
	MFO.WriteLine("# objects for EXT " + extname);
	MFO.WriteBlankLines(1);

	ADD_SOURCES(configure_module_dirname, file_list, extname, obj_dir);

	MFO.WriteBlankLines(1);

	// PHP-GTK and its extensions are always built as shared

	if (dllname == null) {
		if (extname == 'php-gtk') {
			dllname = extname + "2.dll";
			resname = generate_version_info_resource(dllname, configure_module_dirname);
		} else {
			dllname = "php_gtk_" + extname + ".dll";
			dllflags = " $(DLL_LDFLAGS)";
			dep_libs = " $(BUILD_DIR)\\$(PHPGTKLIB) $(LIBS_PHP_GTK)";
		}
	}
	var libname = dllname.substring(0, dllname.length-4) + ".lib";
	var ld = "@$(LD)";

	ADD_FLAG("EXT_TARGETS", "$(BUILD_DIR)\\"+dllname);

	MFO.WriteLine("$(BUILD_DIR)\\" + dllname + ": $(" + EXT + "_GLOBAL_OBJS) $(PHPGTKDLL_RES)");
	MFO.WriteLine("\t" + ld + " /out:$(BUILD_DIR)\\" + dllname + " $(" + EXT + "_LDFLAGS)" + dllflags + " $(LDFLAGS) $(" + EXT + "_GLOBAL_OBJS) $(LIBS_" + EXT + ")" + dep_libs + " $(LIBS) $(PHPGTKDLL_RES)");

	MFO.WriteBlankLines(1);
	MFO.WriteLine(dllname + ": $(BUILD_DIR)\\" + dllname);
	MFO.WriteLine("\t@echo EXT " + extname + " build complete");
	MFO.WriteBlankLines(1);

	ADD_FLAG("CFLAGS_" + EXT, cflags);
}

function ADD_SOURCES(dir, file_list, target, obj_dir) {

	var i;
	var tv;
	var src, obj, sym, flags;
	var core_cflags = "";

	sym = target.toUpperCase().replace(new RegExp("-", "g"), "_") + "_GLOBAL_OBJS";
	flags = "CFLAGS_" + target.toUpperCase().replace(new RegExp("-", "g"), "_");

	if (configure_subst.Exists(sym)) {
		tv = configure_subst.Item(sym);
	} else {
		tv = "";
	}

	if (target != "php-gtk") {
		core_cflags = "$(CFLAGS_PHP_GTK) ";
	}

	file_list = file_list.split(new RegExp("\\s+"));
	file_list.sort();

	var re = new RegExp("\.[a-z0-9A-Z]+$");

	dir = dir.replace(new RegExp("/", "g"), "\\");
	var objs_line = "";
	var srcs_line = "";

	var sub_build = "$(BUILD_DIR)\\";

	/* if module dir is not a child of the main source dir,
	 * we need to tweak it; we should have detected such a
	 * case in condense_path and rewritten the path to
	 * be relative.
	 * This probably breaks for non-sibling dirs */
	if (obj_dir == null) {
		var build_dir = dir.replace(new RegExp("^..\\\\"), "");
		var mangle_dir = build_dir.replace(new RegExp("[\\\\/.+-]", "g"), "_");
		var bd_flags_name = "CFLAGS_BD_" + mangle_dir.toUpperCase();
	}
	else {
		var build_dir = obj_dir.replace(new RegExp("^..\\\\"), "");
		var mangle_dir = build_dir.replace(new RegExp("[\\\\/.+-]", "g"), "_");
		var bd_flags_name = "CFLAGS_BD_" + mangle_dir.toUpperCase();
	}
	
	var dirs = build_dir.split("\\");
	var i, d = "";
	for (i = 0; i < dirs.length; i++) {
		d += dirs[i];
		build_dirs[build_dirs.length] = d;
		d += "\\";
	}
	sub_build += d;


	DEFINE(bd_flags_name, " /Fd" + sub_build + " /Fp" + sub_build + " /FR" + sub_build);

	for (i in file_list) {
		src = file_list[i];
		obj = src.replace(re, ".obj");
		tv += " " + sub_build + obj;

		MFO.WriteLine(sub_build + obj + ": " + dir + "\\" + src);
		MFO.WriteLine("\t@$(CC) $(" + flags + ") " + core_cflags + "$(CFLAGS) $(" + bd_flags_name + ") /c " + dir + "\\" + src + " /Fo" + sub_build + obj);
	}

	DEFINE(sym, tv);
}

function ADD_FLAG(name, flags, target) {

	if (target != null) {
		name = target.toUpperCase() + "_" + name;
	}
	if (configure_subst.Exists(name)) {
		var curr_flags = configure_subst.Item(name);

		if (curr_flags.indexOf(flags) >= 0) {
			return;
		}
		
		flags = curr_flags + " " + flags;
		configure_subst.Remove(name);
	}
	configure_subst.Add(name, flags);
}

function get_define(name) {

	return configure_subst.Item(name);
}

function ERROR(msg) {

	STDERR.WriteLine("ERROR: " + msg);
	WScript.Quit(3);
}

function WARNING(msg) {

	STDERR.WriteLine("WARNING: " + msg);
	STDERR.WriteBlankLines(1);
}

/* Searches a set of paths for a file; returns the dir in which the file was found, true if it
was found in the default env path, or false if it was not found at all. env_name is the optional
name of an env var specifying the default path to search */
function search_paths(thing_to_find, explicit_path, env_name) {

	var i, found = false, place = false, file, env;

	STDOUT.Write("Checking for " + thing_to_find + " ... ");

	if (thing_to_find.length < 6) {
		STDOUT.Write("	");
	}

	thing_to_find = thing_to_find.replace(new RegExp("/", "g"), "\\");

	if (explicit_path != null) {
		if (typeof(explicit_path) == "string") {
			explicit_path = explicit_path.split(";");
		}

		for (i = 0; i < explicit_path.length; i++) {
			file = glob(explicit_path[i] + "\\" + thing_to_find);
			if (file) {
				found = true;
				place = file[0];
				place = place.substr(0, place.length - thing_to_find.length - 1);
				break;
			}
		}
	}

	if (!found && env_name != null) {
		env = WshShell.Environment("Process").Item(env_name);
		env = env.split(";");
		for (i = 0; i < env.length; i++) {
			file = glob(env[i] + "\\" + thing_to_find);
			if (file) {
				found = true;
				place = true;
				break;
			}
		}
	}

	if (found && place == true) {
		STDOUT.WriteLine("	<in default path>");
	} else if (found) {
		STDOUT.WriteLine("	" + place);
	} else {
		STDOUT.WriteLine("	<not found>");
	}
	return place;
}

function word_wrap_and_indent(indent, text, line_suffix, indent_char) {

	if (text == null) {
		return "";
	}

	var words = text.split(new RegExp("\\s+", "g"));
	var i = 0;
	var ret_text = "";
	var this_line = "";
	var t;
	var space = "";
	var lines = 0;

	if (line_suffix == null) {
		line_suffix = "";
	}

	if (indent_char == null) {
		indent_char = " ";
	}

	for (i = 0; i < indent; i++) {
		space += indent_char;
	}
	
	for (i = 0; i < words.length; i++) {
		if (this_line.length) {
			t = this_line + " " + words[i];
		} else {
			t = words[i];
		}

		if (t.length + indent > 78) {
			if (lines++) {
				ret_text += space;
			}
			ret_text += this_line + line_suffix + "\r\n";
			this_line = "";
		}

		if (this_line.length) {
			this_line += " " + words[i];
		} else {
			this_line = words[i];
		}
	}

	if (this_line.length) {
		if (lines)
			ret_text += space;
		ret_text += this_line;
	}

	return ret_text;
}

function file_get_contents(filename) {

	var f, c;

	try {
		f = FSO.OpenTextFile(filename, 1);
		c = f.ReadAll();
		f.Close();
		return c;
	} catch (e) {
		STDOUT.WriteLine("Problem reading " + filename);
		return false;
	}
}

function generate_files() {

	var i, dir, bd, last;

	STDOUT.WriteBlankLines(1);
	STDOUT.WriteLine("Creating build dirs...");
	dir = get_define("BUILD_DIR");
	build_dirs.sort();
	last = null;

	if (!FSO.FolderExists(dir)) {
		FSO.CreateFolder(dir);
	}
	
	for (i = 0; i < build_dirs.length; i++) {
		bd = FSO.BuildPath(dir, build_dirs[i]);
		if (bd == last) {
			continue;
		}
		last = bd;
		ADD_FLAG("BUILD_DIRS_SUB", bd);
		if (!FSO.FolderExists(bd)) {
			FSO.CreateFolder(bd);
		}
	}

	STDOUT.WriteLine("Generating source files - this may take a few seconds");
	WScript.Sleep(3500);
	check_generation();
	generate_makefile();

	STDOUT.WriteLine("Done.");
	STDOUT.WriteBlankLines(1);
	STDOUT.WriteLine("Type 'nmake' to build PHP-GTK");
}

function generate_makefile() {

	MFO.Close(); // Makefile.objects is now complete
	var MF = FSO.CreateTextFile("Makefile", true);
	STDOUT.WriteLine("Generating Makefile");

	MF.WriteLine("# Generated by configure.js");
	MF.WriteBlankLines(1);

	/* spit out variable definitions */
	var keys = (new VBArray(configure_subst.Keys())).toArray();
	var i;

	for (i in keys) {
		/* The trailing space is needed to prevent the trailing backslash that is part of
		the build dir flags (CFLAGS_BD_XXX) from being seen as a line continuation character */
		MF.WriteLine(keys[i] + "=" + configure_subst.Item(keys[i]) + " ");
	}

	MF.WriteBlankLines(1);
	MF.WriteLine("all: $(EXT_TARGETS)");
	MF.WriteLine("build_dirs: $(BUILD_DIR) $(BUILD_DIRS_SUB)");
	MF.WriteBlankLines(1);

	TF = FSO.OpenTextFile("Makefile.objects", 1);
	MF.Write(TF.ReadAll());
	TF.Close();

	MF.Close();

	FSO.DeleteFile("Makefile.objects");
	//FSO.DeleteFile("win32\\temp.bat");
}

function copy_and_subst(srcname, destname, subst_array) {

	if (!FSO.FileExists(srcname)) {
		srcname = configure_module_dirname + "\\" + srcname;
		destname = configure_module_dirname + "\\" + destname;
	}

	var content = file_get_contents(srcname);
	var i;

	for (i = 0; i < subst_array.length; i+=2) {
		var re = subst_array[i];
		var rep = subst_array[i+1];

		content = content.replace(re, rep);
	}

	var f = FSO.CreateTextFile(destname, true);
	f.Write(content);
	f.Close();
}

// glob using simple filename wildcards; returns an array of matches found in the filesystem
function glob(path_pattern) {

	var path_parts = path_pattern.replace(new RegExp("/", "g"), "\\").split("\\");
	var p;
	var base = "";
	var is_pat_re = /\*/;

	if (FSO.FileExists(path_pattern)) {
		return new Array(path_pattern);
	}
	
	// first, build as much as possible that doesn't have a pattern
	for (p = 0; p < path_parts.length; p++) {
		if (path_parts[p].match(is_pat_re))
			break;
		if (p)
			base += "\\";
		base += path_parts[p];	
	}

	return _inner_glob(base, p, path_parts);
}

function _inner_glob(base, p, parts) {

	var pat = parts[p];
	var full_name = base + "\\" + pat;
	var re = null;
	var items = null;

	if (p == parts.length) {
		return false;
	}

	if (FSO.FileExists(full_name)) {
		if (p < parts.length - 1) {
			// we didn't reach the full extent of the pattern
			return false;
		}
		return new Array(full_name);
	}

	if (FSO.FolderExists(full_name) && p == parts.length - 1) {
		// we have reached the end of the pattern; no need to recurse
		return new Array(full_name);
	}

	// Convert the pattern into a regexp
	re = new RegExp("^" + pat.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + "$", "i");

	items = new Array();

	if (!FSO.FolderExists(base)) {
		return false;
	}

	var folder = FSO.GetFolder(base);
	var fc = null;
	var subitems = null;
	var item_name = null;
	var j;

	fc = new Enumerator(folder.SubFolders);
	for (; !fc.atEnd(); fc.moveNext()) {
		item_name = FSO.GetFileName(fc.item());

		if (item_name.match(re)) {
			// got a match; if we are at the end of the pattern, just add these
			// things to the items array
			if (p == parts.length - 1) {
				items[items.length] = fc.item();
			} else {
				// we should recurse and do more matches
				subitems = _inner_glob(base + "\\" + item_name, p + 1, parts);
				if (subitems) {
					for (j = 0; j < subitems.length; j++) {
						items[items.length] = subitems[j];
					}
				}
			}
		}
	}

	// if we are at the end of the pattern, we should match files too
	if (p == parts.length - 1) {
		fc = new Enumerator(folder.Files);
		for (; !fc.atEnd(); fc.moveNext()) {
			item_name = FSO.GetFileName(fc.item());
			if (item_name.match(re)) {
				items[items.length] = fc.item();
			}
		}
	}

	if (items.length == 0)
		return false;

	return items;
}

/* Emits rule to generate version info for an extension.
Returns the name of the .res file that will be generated */
function generate_version_info_resource(makefiletarget, creditspath) {

	// makefiletarget is php-gtk.dll
	// creditspath is ext\gtk+

	var resname = makefiletarget + ".res";
	var res_desc = "PHP-GTK Script Interpreter";
	var res_prod_name = "PHP-GTK";
	var credits;
	var thanks = "Thanks to Andrei Zmievski";
	var logo = "";

	if (FSO.FileExists(creditspath + '/CREDITS')) {
		credits = FSO.OpenTextFile(creditspath + '/CREDITS', 1);
		res_desc = credits.ReadLine();
		try {
			thanks = credits.ReadLine();
		} catch (e) {
			thanks = null;
		}
		if (thanks == null) {
			thanks = "";
		} else {
			thanks = "Thanks to " + thanks;
		}
		credits.Close();
	}

	MFO.WriteLine("PHPGTKDLL_RES=$(BUILD_DIR)\\$(PHPGTKDLL).res");
	MFO.WriteBlankLines(1);

	if (makefiletarget.match(new RegExp("\\.exe$"))) {
		logo = " /D WANT_LOGO";
	}
	
	MFO.WriteLine("$(PHPGTKDLL_RES): win32\\template.rc");
	MFO.WriteLine("\t$(RC) /fo $(PHPGTKDLL_RES)" + logo + ' /D FILE_DESCRIPTION="\\"' + res_desc + '\\"" /D FILE_NAME="\\"$(PHPGTKDLL)\\"" /D PRODUCT_NAME="\\"' + res_prod_name + '\\"" /D THANKS_GUYS="\\"' + thanks + '\\"" win32\\template.rc');
	MFO.WriteBlankLines(1);
	
	return resname;
}

/* execute a command and return the output as a string */
function execute(command_line) {
	var e = WshShell.Exec(command_line);
	var ret = "";

	ret = e.StdOut.ReadAll();

	return ret;
}

// Which version of the compiler do we have?
function probe_msvc_compiler_version(CL) {

	// tricky escapes to get stderr redirection to work
	var banner = execute('cmd /c ""' + CL + '" 2>&1"');

	if (banner.match(/(\d+)\.(\d+)\.(\d+)(\.(\d+))?/)) {
		return RegExp.$1;
	}
	return 0;
}

// Poke around for some headers
function probe_basic_headers()
{
	var p;

	if (PHP_GTK_PHP_BUILD != "no") {
		php_usual_include_suspects += ";" + PHP_GTK_PHP_BUILD + "\\include";
		php_usual_lib_suspects += ";" + PHP_GTK_PHP_BUILD + "\\lib";
	}

	// hack to catch common location of libs
	if (typeof(p) == "string") {
		p = p.replace(new RegExp("include$"), "lib");
		ADD_FLAG("LDFLAGS", '/libpath:"' + p + '" ');
		php_usual_lib_suspects += ";" + p;
	}
}

/* non-functions */

if (!FSO.FileExists("buildconf.bat")) {
	STDERR.WriteLine("Must be run from the root of the PHP-GTK source");
	WScript.Quit(10);
}
