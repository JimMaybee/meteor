var mori = Npm.require('mori');

var resultEquals = function (test, actual, expected) {
  actual = mori.set(mori.vals(actual));
  expected = mori.set(expected);
  test.isTrue(mori.equals(actual, expected), actual + " VS " + expected);
};

Tinytest.add("constraint solver - resolver, get exact deps", function (test) {
  // Fat arrow - exact deps
  // Thin arrow - inexact dep or no constraint
  // A => B => C
  //  \    \-> D => E
  //   \->  \-> F
  var resolver = new ConstraintSolver.Resolver();
  var A100 = new ConstraintSolver.UnitVersion("A", "1.0.0", "1.0.0");
  var B100 = new ConstraintSolver.UnitVersion("B", "1.0.0", "1.0.0");
  var C100 = new ConstraintSolver.UnitVersion("C", "1.0.0", "1.0.0");
  var D110 = new ConstraintSolver.UnitVersion("D", "1.1.0", "1.0.0");
  var E100 = new ConstraintSolver.UnitVersion("E", "1.0.0", "1.0.0");
  var F120 = new ConstraintSolver.UnitVersion("F", "1.2.0", "1.0.0");
  // Ensure that the resolver knows that these versions exist and have ECV =
  // 1.0.0.
  var F100 = new ConstraintSolver.UnitVersion("F", "1.0.0", "1.0.0");
  var F110 = new ConstraintSolver.UnitVersion("F", "1.1.0", "1.0.0");

  resolver.addUnitVersion(A100);
  resolver.addUnitVersion(B100);
  resolver.addUnitVersion(C100);
  resolver.addUnitVersion(D110);
  resolver.addUnitVersion(E100);
  resolver.addUnitVersion(F100);
  resolver.addUnitVersion(F110);
  resolver.addUnitVersion(F120);

  A100.addDependency("B");
  A100.addConstraint(resolver.getConstraint("B", "=1.0.0"));
  B100.addDependency("C");
  B100.addConstraint(resolver.getConstraint("C", "=1.0.0"));
  // a dependency w/o a constraint, still should pick it
  B100.addDependency("D");
  D110.addDependency("E");
  D110.addConstraint(resolver.getConstraint("E", "=1.0.0"));
  B100.addDependency("F");
  // a non-exact constraint
  B100.addConstraint(resolver.getConstraint("F", "1.0.0"));
  A100.addDependency("F");
  A100.addConstraint(resolver.getConstraint("F", "1.1.0"));

  var solution = resolver.resolve(["A"], [], {
    // Prefer later F when possible.
    costFunction: function (state) {
      var F = mori.get(state.choices, "F");
      var distanceF = F ? semver2number(F.version) : 0;
      return -distanceF;
    }
  });

  resultEquals(test, solution, [A100, B100, C100, D110, E100, F120]);
});

Tinytest.add("constraint solver - resolver, cost function - pick latest", function (test) {
  var resolver = new ConstraintSolver.Resolver();
  var A100 = new ConstraintSolver.UnitVersion("A", "1.0.0", "1.0.0");
  var A110 = new ConstraintSolver.UnitVersion("A", "1.1.0", "1.0.0");
  var B100 = new ConstraintSolver.UnitVersion("B", "1.0.0", "1.0.0");
  var C100 = new ConstraintSolver.UnitVersion("C", "1.0.0", "1.0.0");
  var C110 = new ConstraintSolver.UnitVersion("C", "1.1.0", "1.0.0");
  var C120 = new ConstraintSolver.UnitVersion("C", "1.2.0", "1.0.0");

  resolver.addUnitVersion(A100);
  resolver.addUnitVersion(A110);
  resolver.addUnitVersion(B100);
  resolver.addUnitVersion(C100);
  resolver.addUnitVersion(C110);
  resolver.addUnitVersion(C120);

  A100.addDependency("C");
  A110.addDependency("C");
  B100.addDependency("A");
  B100.addConstraint(resolver.getConstraint("A", "=1.0.0"));
  B100.addDependency("C");
  B100.addConstraint(resolver.getConstraint("C", "1.1.0"));

  // Run looking for a conservative solution for A
  var AOnlySolution = resolver.resolve(["A"], [], {
    costFunction: function (state) {
      var A = mori.get(state.choices, "A");
      var distanceA = A ? semver2number(A.version) : 0;
      return distanceA - 100;
    }
  });

  resultEquals(test, AOnlySolution, [A100, C100]);

  var AnBSolution = resolver.resolve(["A", "B"], [], {
    costFunction: function (state) {
      var C = mori.get(state.choices, "C");
      var A = mori.get(state.choices, "A");
      var distanceC = C ? semver2number(C.version) : 0;
      var distanceA = A ? semver2number(A.version) : 0;
      return 1000000000 - distanceC - distanceA;
    }
  });

  resultEquals(test, AnBSolution, [A100, B100, C120]);
});

Tinytest.add("constraint solver - resolver, cost function - avoid upgrades", function (test) {
  var resolver = new ConstraintSolver.Resolver();
  var A100 = new ConstraintSolver.UnitVersion("A", "1.0.0", "1.0.0");
  var A110 = new ConstraintSolver.UnitVersion("A", "1.1.0", "1.0.0");
  var B100 = new ConstraintSolver.UnitVersion("B", "1.0.0", "1.0.0");
  var B110 = new ConstraintSolver.UnitVersion("B", "1.1.0", "1.0.0");
  var C100 = new ConstraintSolver.UnitVersion("C", "1.0.0", "1.0.0");

  resolver.addUnitVersion(A100);
  resolver.addUnitVersion(A110);
  resolver.addUnitVersion(B100);
  resolver.addUnitVersion(B110);
  resolver.addUnitVersion(C100);

  A100.addDependency("B");
  A100.addConstraint(resolver.getConstraint("B", "1.1.0"));
  A110.addDependency("C");
  A110.addConstraint(resolver.getConstraint("C", "1.0.0"));

  // We had one dependency on B and the previous run of resolver told us to us
  // B@1.0.0. Now we are adding the package A in a conservative manner. The
  // constraint solver should keep B from upgrading by picking a newer version
  // of A that uses C.
  var lockedVersions = [B100];
  var solution = resolver.resolve(["A", "B"], [], {
    costFunction: function (state) {
      return mori.reduce(mori.sum, 0, mori.map(function (nameAndUv) {
        var name = mori.first(nameAndUv);
        var uv = mori.last(nameAndUv);
        var lockedVersion = _.findWhere(lockedVersions, {name: name});
        if (! lockedVersion || lockedVersion === uv)
          return 0;
        return 100;
      }, state.choices));
    }
  });

  resultEquals(test, solution, [A110, B100, C100]);
});

Tinytest.add("constraint solver - resolver, don't pick rcs", function (test) {
  var resolver = new ConstraintSolver.Resolver();
  var A100 = new ConstraintSolver.UnitVersion("A", "1.0.0", "1.0.0");
  var A100rc1 = new ConstraintSolver.UnitVersion("A", "1.0.0-rc1", "1.0.0");

  resolver.addUnitVersion(A100rc1);
  resolver.addUnitVersion(A100);
  var basicConstraint = resolver.getConstraint("A", "");
  var rcConstraint = resolver.getConstraint("A", "1.0.0-rc1");

  // Make the non-rc one more costly. But we still shouldn't choose it unless it
  // was specified in an initial constraint!
  var proRcCostFunction = function (state) {
    return mori.reduce(mori.sum, 0, mori.map(function (nameAndUv) {
      var name = mori.first(nameAndUv);
      var uv = mori.last(nameAndUv);
      // Make the non-rc one more costly. But we still shouldn't choose it!
      if (uv.version === "1.0.0")
        return 100;
      return 0;
    }, state.choices));
  };

  var solution = resolver.resolve(
    ["A"], [basicConstraint], {costFunction: proRcCostFunction });
  resultEquals(test, solution, [A100]);

  solution = resolver.resolve(
    ["A"], [rcConstraint], {costFunction: proRcCostFunction });
  resultEquals(test, solution, [A100rc1]);
});

function semver2number (semverStr) {
  return parseInt(semverStr.replace(/\./g, ""));
}

